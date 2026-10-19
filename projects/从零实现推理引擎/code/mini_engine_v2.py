"""MiniEngine v2：连续批处理（continuous batching）最小实现。

v1 一次只服务一个请求；v2 引入：
- waiting / running 双队列；
- 每步动态准入（受 max_batch_size 限制）；
- prefill 与 decode 混在同一个 engine step 里；
- 串行 vs 连续批处理的吞吐/TTFT 对照。

模型复用 mini_engine_v1 的 HybridModel；为了在 CPU 上放大调度差异，
每个 batch 调用会 sleep 一个很小的 step_delay_ms，模拟一次 GPU forward。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np

from mini_engine_v1 import EOS_ID, HybridModel, KVCache, TOKEN_TO_ID, VOCAB


@dataclass
class Request:
    rid: int
    prompt: list[str]
    max_new_tokens: int = 6
    arrival_step: int = 0
    prompt_ids: list[int] = field(init=False)
    output_ids: list[int] = field(default_factory=list)
    cache: KVCache | None = None
    last_token: int | None = None
    start_time: float = 0.0
    first_token_time: float | None = None
    finish_time: float | None = None

    def __post_init__(self) -> None:
        self.prompt_ids = [TOKEN_TO_ID[t] for t in self.prompt]

    @property
    def output_tokens(self) -> list[str]:
        return [VOCAB[i] for i in self.output_ids]

    @property
    def finished(self) -> bool:
        return bool(self.output_ids) and (
            self.output_ids[-1] == EOS_ID
            or len(self.output_ids) >= self.max_new_tokens
        )


class BatchModel:
    """把单请求 prefill/decode 包装成「一次 batch 调用」。"""

    def __init__(self, model: HybridModel, delay_ms: float = 1.0) -> None:
        self.model = model
        self.delay_ms = delay_ms
        self.batch_calls = 0
        self.batched_tokens = 0

    def _sleep(self) -> None:
        if self.delay_ms > 0:
            time.sleep(self.delay_ms / 1000.0)

    def prefill_batch(self, prompts: list[list[int]]) -> list[tuple[np.ndarray, KVCache]]:
        self.batch_calls += 1
        self.batched_tokens += sum(len(p) for p in prompts)
        self._sleep()
        return [self.model.prefill(p) for p in prompts]

    def decode_batch(self, items: list[tuple[int, KVCache]]) -> list[tuple[np.ndarray, KVCache]]:
        self.batch_calls += 1
        self.batched_tokens += len(items)
        self._sleep()
        return [self.model.decode(token, cache) for token, cache in items]


def _sample(logits: np.ndarray) -> int:
    return int(np.argmax(logits))


def run_serial(
    model: HybridModel, requests: list[Request], delay_ms: float
) -> tuple[list[Request], float, int]:
    """v1 风格：一个请求完全结束后，才处理下一个。"""
    batch_model = BatchModel(model, delay_ms)
    started = time.perf_counter()
    for req in sorted(requests, key=lambda r: r.arrival_step):
        req.start_time = time.perf_counter()
        logits, cache = batch_model.prefill_batch([req.prompt_ids])[0]
        req.cache = cache
        req.last_token = _sample(logits)
        req.output_ids.append(req.last_token)
        req.first_token_time = time.perf_counter()
        while not req.finished:
            logits, cache = batch_model.decode_batch([(req.last_token, req.cache)])[0]
            req.cache = cache
            req.last_token = _sample(logits)
            req.output_ids.append(req.last_token)
        req.finish_time = time.perf_counter()
    wall = time.perf_counter() - started
    return requests, wall, batch_model.batch_calls


def run_continuous(
    model: HybridModel,
    requests: list[Request],
    delay_ms: float,
    max_batch_size: int = 3,
) -> tuple[list[Request], float, int]:
    """v2：请求动态到达，每步把 running 请求拼成一个 batch。"""
    batch_model = BatchModel(model, delay_ms)
    waiting = sorted(requests, key=lambda r: (r.arrival_step, r.rid))
    running: list[Request] = []
    completed: list[Request] = []
    step = 0
    started = time.perf_counter()

    while waiting or running:
        if not running and waiting and waiting[0].arrival_step > step:
            step = waiting[0].arrival_step

        newly: list[Request] = []
        while waiting and waiting[0].arrival_step <= step and len(running) + len(newly) < max_batch_size:
            req = waiting.pop(0)
            req.start_time = time.perf_counter()
            newly.append(req)

        if newly:
            results = batch_model.prefill_batch([r.prompt_ids for r in newly])
            for req, (logits, cache) in zip(newly, results):
                req.cache = cache
                req.last_token = _sample(logits)
                req.output_ids.append(req.last_token)
                req.first_token_time = time.perf_counter()
                running.append(req)

        # 新准入的请求本步已经采样了第一个 token，不再重复 decode
        decode_reqs = [r for r in running if r not in newly and not r.finished]
        if decode_reqs:
            results = batch_model.decode_batch(
                [(r.last_token, r.cache) for r in decode_reqs]
            )
            for req, (logits, cache) in zip(decode_reqs, results):
                req.cache = cache
                req.last_token = _sample(logits)
                req.output_ids.append(req.last_token)

        for req in list(running):
            if req.finished:
                req.finish_time = time.perf_counter()
                running.remove(req)
                completed.append(req)

        step += 1
        if step > 10_000:
            raise RuntimeError("scheduler did not converge")

    wall = time.perf_counter() - started
    return completed, wall, batch_model.batch_calls


def workload() -> list[Request]:
    patterns = [
        ["<bos>", "the", "cat"],
        ["<bos>", "a", "dog"],
        ["<bos>", "the", "cat", "sat"],
        ["<bos>", "a", "dog", "ran"],
        ["<bos>", "the", "cat"],
        ["<bos>", "a", "dog"],
    ]
    return [
        Request(rid=i, prompt=p, max_new_tokens=6, arrival_step=arrival)
        for i, (p, arrival) in enumerate(
            zip(patterns, [0, 0, 1, 3, 5, 8])
        )
    ]


def report(name: str, reqs: list[Request], wall: float, calls: int) -> None:
    total_out = sum(len(r.output_ids) for r in reqs)
    ttfts = [(r.first_token_time - r.start_time) * 1000 for r in reqs]
    tpots = [
        (r.finish_time - r.first_token_time) * 1000 / max(1, len(r.output_ids) - 1)
        for r in reqs
    ]
    print(f"\n=== {name} ===")
    print(f"wall_time={wall * 1000:.2f} ms, batch_calls={calls}")
    print(f"output_tokens={total_out}, throughput={total_out / wall:.1f} tok/s")
    print(f"avg_TTFT={sum(ttfts) / len(ttfts):.2f} ms, "
          f"avg_TPOT={sum(tpots) / len(tpots):.2f} ms")
    for r in reqs:
        print(f"  req{r.rid}: {r.output_tokens} "
              f"(arrival_step={r.arrival_step})")


def main() -> None:
    delay_ms = 1.0
    serial_model = HybridModel(seed=0)
    serial_reqs, serial_wall, serial_calls = run_serial(
        serial_model, workload(), delay_ms
    )
    report("serial (v1 style)", serial_reqs, serial_wall, serial_calls)

    batch_model = HybridModel(seed=0)
    batch_reqs, batch_wall, batch_calls = run_continuous(
        batch_model, workload(), delay_ms, max_batch_size=3
    )
    report("continuous batching (v2)", batch_reqs, batch_wall, batch_calls)

    serial_outputs = {r.rid: r.output_tokens for r in serial_reqs}
    batch_outputs = {r.rid: r.output_tokens for r in batch_reqs}
    print(f"\noutputs identical: {serial_outputs == batch_outputs}")
    print(f"speedup: {serial_wall / batch_wall:.2f}x")


if __name__ == "__main__":
    main()

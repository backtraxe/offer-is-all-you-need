"""MiniEngine v0：一次只服务一个请求的最小推理循环。

只依赖标准库 + numpy，目的是把「推理引擎到底在循环什么」跑通，
不追求真实模型质量。第 2 章会把这里的 ToyModel 换成带 KV Cache 的
小 Transformer。
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np


VOCAB = [
    "<bos>", "the", "cat", "sat", "on", "mat", ".",
    "<eos>", "a", "dog", "ran", "away",
]
TOKEN_TO_ID = {token: i for i, token in enumerate(VOCAB)}
EOS = "<eos>"


class ToyModel:
    """一个确定性的 bigram 模型：给定最后一个 token，输出下一个 token 的 logits。"""

    def __init__(self) -> None:
        self.vocab_size = len(VOCAB)
        self.calls = 0
        self.tokens_seen = 0
        # 手工写一条合理的英文链：the cat sat on mat . <eos>
        self.transition = np.full((self.vocab_size, self.vocab_size), -5.0)
        chain = ["<bos>", "the", "cat", "sat", "on", "mat", ".", "<eos>"]
        for src, dst in zip(chain, chain[1:]):
            self.transition[TOKEN_TO_ID[src], TOKEN_TO_ID[dst]] = 5.0
        # 给一点分支，避免所有 prompt 都走同一条路
        self.transition[TOKEN_TO_ID["a"], TOKEN_TO_ID["dog"]] = 5.0
        self.transition[TOKEN_TO_ID["dog"], TOKEN_TO_ID["ran"]] = 5.0
        self.transition[TOKEN_TO_ID["ran"], TOKEN_TO_ID["away"]] = 5.0
        self.transition[TOKEN_TO_ID["away"], TOKEN_TO_ID["."]] = 5.0

    def forward(self, token_ids: list[int]) -> np.ndarray:
        """返回下一个 token 的 logits。

        注意：v0 每次都会把整段 token_ids 重新“过一遍模型”。真实模型里
        这就是重复计算 prefix 的 K/V；第 2 章会用 KV Cache 消掉它。
        """
        self.calls += 1
        self.tokens_seen += len(token_ids)
        last = token_ids[-1]
        logits = self.transition[last].copy()
        # 位置相关的微小扰动，让输出看起来不是完全静态表
        logits += 0.01 * (len(token_ids) % 3)
        return logits


@dataclass
class Request:
    prompt: list[str]
    max_new_tokens: int = 8


@dataclass
class Result:
    output_tokens: list[str]
    latency_s: float
    model_calls: int
    tokens_seen: int


class Engine:
    def __init__(self, model: ToyModel) -> None:
        self.model = model

    def generate(self, request: Request) -> Result:
        token_ids = [TOKEN_TO_ID[t] for t in request.prompt]
        output: list[str] = []
        calls_before = self.model.calls
        tokens_before = self.model.tokens_seen
        start = time.perf_counter()

        for _ in range(request.max_new_tokens):
            logits = self.model.forward(token_ids)
            next_id = int(np.argmax(logits))
            next_token = VOCAB[next_id]
            token_ids.append(next_id)
            output.append(next_token)
            if next_token == EOS:
                break

        elapsed = time.perf_counter() - start
        return Result(
            output_tokens=output,
            latency_s=elapsed,
            model_calls=self.model.calls - calls_before,
            tokens_seen=self.model.tokens_seen - tokens_before,
        )


def main() -> None:
    model = ToyModel()
    engine = Engine(model)
    requests = [
        Request(["<bos>", "the", "cat"], max_new_tokens=8),
        Request(["<bos>", "a", "dog"], max_new_tokens=8),
        Request(["<bos>", "the", "cat", "sat"], max_new_tokens=8),
    ]

    total_tokens = 0
    total_time = 0.0
    for i, request in enumerate(requests, 1):
        result = engine.generate(request)
        total_tokens += len(result.output_tokens)
        total_time += result.latency_s
        print(f"[request {i}] prompt={request.prompt}")
        print(f"  output={result.output_tokens}")
        print(
            f"  latency={result.latency_s * 1000:.3f} ms, "
            f"model_calls={result.model_calls}, "
            f"tokens_seen={result.tokens_seen}"
        )

    print("\n--- summary ---")
    print(f"requests={len(requests)} output_tokens={total_tokens}")
    print(f"wall_time={total_time * 1000:.3f} ms")
    print(f"throughput={total_tokens / total_time:.1f} tok/s")
    print(f"model_calls={model.calls}, tokens_seen={model.tokens_seen}")


if __name__ == "__main__":
    main()

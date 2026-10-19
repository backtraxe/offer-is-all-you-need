"""MiniEngine v1：prefill + decode，带 KV Cache 的最小引擎。

ToyModel 仍是一个「bigram 为主 + 小型 causal attention 为辅」的混合模型：
- bigram 项保证输出可读、可对照；
- attention 项让 forward 真正依赖整段 prefix，从而能验证 KV Cache 的等价性。

只依赖 numpy。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import numpy as np


VOCAB = [
    "<bos>", "the", "cat", "sat", "on", "mat", ".",
    "<eos>", "a", "dog", "ran", "away",
]
TOKEN_TO_ID = {token: i for i, token in enumerate(VOCAB)}
EOS = "<eos>"
V = len(VOCAB)
D = 16
MAX_LEN = 64
EOS_ID = TOKEN_TO_ID[EOS]


def build_bigram() -> np.ndarray:
    transition = np.full((V, V), -5.0)
    chain = ["<bos>", "the", "cat", "sat", "on", "mat", ".", "<eos>"]
    for src, dst in zip(chain, chain[1:]):
        transition[TOKEN_TO_ID[src], TOKEN_TO_ID[dst]] = 5.0
    transition[TOKEN_TO_ID["a"], TOKEN_TO_ID["dog"]] = 5.0
    transition[TOKEN_TO_ID["dog"], TOKEN_TO_ID["ran"]] = 5.0
    transition[TOKEN_TO_ID["ran"], TOKEN_TO_ID["away"]] = 5.0
    transition[TOKEN_TO_ID["away"], TOKEN_TO_ID["."]] = 5.0
    return transition


class HybridModel:
    def __init__(self, seed: int = 0) -> None:
        rng = np.random.default_rng(seed)
        self.bigram = build_bigram()
        self.emb = rng.normal(0, 0.1, (V, D))
        self.pos = rng.normal(0, 0.1, (MAX_LEN, D))
        self.wq = rng.normal(0, 0.2, (D, D))
        self.wk = rng.normal(0, 0.2, (D, D))
        self.wv = rng.normal(0, 0.2, (D, D))
        self.wo = rng.normal(0, 0.2, (D, D))
        self.wout = rng.normal(0, 0.2, (D, V))
        self.full_calls = 0
        self.full_tokens = 0
        self.cached_calls = 0
        self.cached_tokens = 0

    def _x(self, token_ids: list[int], start: int = 0) -> np.ndarray:
        idx = np.asarray(token_ids, dtype=np.int64)
        return self.emb[idx] + self.pos[start:start + len(token_ids)]

    def _kv(self, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return x @ self.wk, x @ self.wv

    def _attend(self, q: np.ndarray, k: np.ndarray, v: np.ndarray) -> np.ndarray:
        # q: [Tq, D], k/v: [Tk, D]，因果 mask 只对 full 路径需要；
        # cached 路径的 q 只有最后一行，天然只看得到历史。
        scores = q @ k.T / np.sqrt(D)
        if q.shape[0] > 1:
            tq, tk = scores.shape
            mask = np.triu(np.ones((tq, tk), dtype=bool), k=1)
            scores = np.where(mask, -1e9, scores)
        weights = np.exp(scores - scores.max(axis=-1, keepdims=True))
        weights = weights / weights.sum(axis=-1, keepdims=True)
        return weights @ v

    def _head(self, x: np.ndarray, k: np.ndarray, v: np.ndarray) -> np.ndarray:
        q = x @ self.wq
        attn = self._attend(q, k, v)
        h = x + attn @ self.wo
        return h @ self.wout

    def forward_full(self, token_ids: list[int]) -> np.ndarray:
        """v0 路径：每步重算整段 prefix。"""
        self.full_calls += 1
        self.full_tokens += len(token_ids)
        x = self._x(token_ids)
        k, v = self._kv(x)
        logits = self.bigram[token_ids[-1]] + 0.1 * self._head(x, k, v)[-1]
        return logits

    def prefill(self, token_ids: list[int]) -> tuple[np.ndarray, "KVCache"]:
        """v1 路径：prompt 只算一次，留下 K/V。"""
        self.cached_calls += 1
        self.cached_tokens += len(token_ids)
        x = self._x(token_ids)
        k, v = self._kv(x)
        logits = self.bigram[token_ids[-1]] + 0.1 * self._head(x, k, v)[-1]
        return logits, KVCache(k=k, v=v)

    def decode(self, token_id: int, cache: "KVCache") -> tuple[np.ndarray, "KVCache"]:
        """v1 路径：decode 每步只算 1 个新 token。"""
        self.cached_calls += 1
        self.cached_tokens += 1
        pos = len(cache)
        x = self._x([token_id], start=pos)
        k_new, v_new = self._kv(x)
        k_all = np.concatenate([cache.k, k_new], axis=0)
        v_all = np.concatenate([cache.v, v_new], axis=0)
        logits = self.bigram[token_id] + 0.1 * self._head(x, k_all, v_all)[-1]
        return logits, KVCache(k=k_all, v=v_all)


@dataclass
class KVCache:
    k: np.ndarray
    v: np.ndarray

    def __len__(self) -> int:
        return int(self.k.shape[0])

    @property
    def nbytes(self) -> int:
        return int(self.k.nbytes + self.v.nbytes)


@dataclass
class Request:
    prompt: list[str]
    max_new_tokens: int = 8


@dataclass
class Result:
    output_tokens: list[str]
    latency_s: float
    calls: int
    tokens_seen: int
    kv_bytes: int
    logits: list[np.ndarray] = field(default_factory=list)


def generate_full(model: HybridModel, request: Request) -> Result:
    ids = [TOKEN_TO_ID[t] for t in request.prompt]
    out, logits = [], []
    calls_before, tokens_before = model.full_calls, model.full_tokens
    start = time.perf_counter()
    for _ in range(request.max_new_tokens):
        step_logits = model.forward_full(ids)
        logits.append(step_logits)
        next_id = int(np.argmax(step_logits))
        ids.append(next_id)
        out.append(VOCAB[next_id])
        if next_id == EOS_ID:
            break
    return Result(
        out, time.perf_counter() - start,
        model.full_calls - calls_before,
        model.full_tokens - tokens_before,
        0, logits,
    )


def generate_cached(model: HybridModel, request: Request) -> Result:
    ids = [TOKEN_TO_ID[t] for t in request.prompt]
    out, logits = [], []
    calls_before, tokens_before = model.cached_calls, model.cached_tokens
    start = time.perf_counter()
    step_logits, cache = model.prefill(ids)
    for _ in range(request.max_new_tokens):
        logits.append(step_logits)
        next_id = int(np.argmax(step_logits))
        ids.append(next_id)
        out.append(VOCAB[next_id])
        if next_id == EOS_ID:
            break
        step_logits, cache = model.decode(next_id, cache)
    return Result(
        out, time.perf_counter() - start,
        model.cached_calls - calls_before,
        model.cached_tokens - tokens_before,
        cache.nbytes, logits,
    )


def main() -> None:
    model = HybridModel(seed=0)
    request = Request(["<bos>", "the", "cat"], max_new_tokens=8)

    full = generate_full(model, request)
    cached = generate_cached(model, request)

    print("prompt:", request.prompt)
    print("v0 full  :", full.output_tokens)
    print("v1 cached:", cached.output_tokens)
    print(f"tokens_seen: full={full.tokens_seen}, cached={cached.tokens_seen}")
    print(f"KV bytes  : {cached.kv_bytes} (toy D={D}, 仅作比例演示)")
    diffs = [float(np.max(np.abs(a - b))) for a, b in zip(full.logits, cached.logits)]
    print(f"max |logits diff| across steps: {max(diffs):.2e}")
    print(f"outputs identical: {full.output_tokens == cached.output_tokens}")


if __name__ == "__main__":
    main()

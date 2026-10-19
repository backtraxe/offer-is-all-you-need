"""采样与停止条件：greedy / temperature / top-k / top-p / 惩罚 / stop。

只依赖 numpy。所有函数都是纯函数，方便单测与在引擎里复用。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class SamplingParams:
    temperature: float = 1.0
    top_k: int = 0          # 0 = 不限制
    top_p: float = 1.0      # 1.0 = 不限制
    repetition_penalty: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    seed: int | None = None


@dataclass
class StoppingCriteria:
    eos_token_id: int | None = None
    max_new_tokens: int = 16
    stop_strings: list[str] = field(default_factory=list)

    def should_stop(self, new_token_id: int, text: str, generated: int) -> bool:
        if generated >= self.max_new_tokens:
            return True
        if self.eos_token_id is not None and new_token_id == self.eos_token_id:
            return True
        return any(text.endswith(s) for s in self.stop_strings)


def apply_repetition_penalty(
    logits: np.ndarray, generated_ids: list[int], penalty: float
) -> np.ndarray:
    if penalty == 1.0 or not generated_ids:
        return logits
    out = logits.copy()
    for token in set(generated_ids):
        if out[token] > 0:
            out[token] /= penalty
        else:
            out[token] *= penalty
    return out


def apply_frequency_presence_penalty(
    logits: np.ndarray,
    generated_ids: list[int],
    frequency_penalty: float,
    presence_penalty: float,
) -> np.ndarray:
    if not generated_ids or (frequency_penalty == 0 and presence_penalty == 0):
        return logits
    out = logits.copy()
    counts: dict[int, int] = {}
    for token in generated_ids:
        counts[token] = counts.get(token, 0) + 1
    for token, count in counts.items():
        out[token] -= frequency_penalty * count
        out[token] -= presence_penalty
    return out


def top_k_filter(logits: np.ndarray, k: int) -> np.ndarray:
    if k <= 0 or k >= logits.shape[0]:
        return logits
    out = np.full_like(logits, -np.inf)
    idx = np.argpartition(logits, -k)[-k:]
    out[idx] = logits[idx]
    return out


def top_p_filter(logits: np.ndarray, p: float) -> np.ndarray:
    if p >= 1.0:
        return logits
    if p <= 0.0:
        raise ValueError("top_p must be > 0")
    # 先按 logits 排序，softmax 后再按累计概率截断
    order = np.argsort(logits)[::-1]
    sorted_logits = logits[order]
    probs = softmax(sorted_logits)
    cumulative = np.cumsum(probs)
    # 保留累计概率首次 >= p 的那个 token
    cutoff = int(np.searchsorted(cumulative, p, side="left")) + 1
    keep = order[:cutoff]
    out = np.full_like(logits, -np.inf)
    out[keep] = logits[keep]
    return out


def softmax(logits: np.ndarray, temperature: float = 1.0) -> np.ndarray:
    if temperature <= 0:
        raise ValueError("temperature must be > 0; use greedy for temperature=0")
    z = logits / temperature
    z = z - z.max()
    exp = np.exp(z)
    return exp / exp.sum()


def sample_token(
    logits: np.ndarray,
    params: SamplingParams,
    generated_ids: list[int],
    rng: np.random.Generator,
) -> int:
    """按参数采样一个 token；temperature=0 时退化为 greedy。"""
    logits = apply_repetition_penalty(
        logits, generated_ids, params.repetition_penalty
    )
    logits = apply_frequency_presence_penalty(
        logits,
        generated_ids,
        params.frequency_penalty,
        params.presence_penalty,
    )
    if params.temperature == 0:
        return int(np.argmax(logits))
    logits = top_k_filter(logits, params.top_k)
    logits = top_p_filter(logits, params.top_p)
    probs = softmax(logits, params.temperature)
    return int(rng.choice(len(probs), p=probs))


def make_rng(seed: int | None) -> np.random.Generator:
    return np.random.default_rng(seed)

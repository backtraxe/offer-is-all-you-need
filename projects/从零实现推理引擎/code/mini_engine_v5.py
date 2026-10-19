"""MiniEngine v5：采样与停止条件的可运行演示。

这一版不接 KV Cache，专注把「logits -> 概率 -> token」这条链路讲清楚：
- temperature 怎么改变分布；
- top-k / top-p 怎么截断候选；
- repetition / frequency / presence penalty 怎么改 logits；
- EOS / max_tokens / stop strings 怎么停。
"""

from __future__ import annotations

from collections import Counter

import numpy as np

from sampling import (
    SamplingParams,
    StoppingCriteria,
    apply_frequency_presence_penalty,
    apply_repetition_penalty,
    make_rng,
    sample_token,
    softmax,
    top_k_filter,
    top_p_filter,
)


LABELS = ["A", "B", "C", "D", "E"]
BASE_LOGITS = np.array([2.0, 1.5, 1.0, 0.5, 0.0])


def fmt_probs(probs: np.ndarray) -> str:
    return "  ".join(f"{label}:{p:.3f}" for label, p in zip(LABELS, probs))


def demo_distribution() -> None:
    print("=== 1) temperature 改变分布 ===")
    for temp in [0.5, 1.0, 2.0]:
        probs = softmax(BASE_LOGITS, temp)
        print(f"T={temp:<4} {fmt_probs(probs)}")
    print("T→0 等价 greedy：", LABELS[int(np.argmax(BASE_LOGITS))])

    print("\n=== 2) top-k / top-p 截断候选 ===")
    k_logits = top_k_filter(BASE_LOGITS, 2)
    print("top_k=2 保留：", [LABELS[i] for i in np.where(np.isfinite(k_logits))[0]])
    p_logits = top_p_filter(BASE_LOGITS, 0.8)
    print("top_p=0.8 保留：", [LABELS[i] for i in np.where(np.isfinite(p_logits))[0]])


def demo_penalties() -> None:
    print("\n=== 3) 重复惩罚改变 argmax ===")
    logits = np.array([3.0, 2.9, 1.0])
    generated = [0, 0, 0]
    print("原始 logits:", logits, "-> argmax", int(np.argmax(logits)))
    penalized = apply_repetition_penalty(logits, generated, 2.0)
    print("repetition=2.0:", penalized, "-> argmax", int(np.argmax(penalized)))

    freq = apply_frequency_presence_penalty(
        logits, generated, frequency_penalty=0.5, presence_penalty=0.5
    )
    print("frequency/presence=0.5:", freq, "-> argmax", int(np.argmax(freq)))


def demo_stop() -> None:
    print("\n=== 4) stop strings / EOS / max_new_tokens ===")
    criteria = StoppingCriteria(
        eos_token_id=99, max_new_tokens=8, stop_strings=["</s>"]
    )
    stream = ["Hello", " world", "</s>", " ignored"]
    text = ""
    kept = []
    for i, token in enumerate(stream, 1):
        text += token
        kept.append(token)
        if criteria.should_stop(i, text, i):
            print(f"step {i}: stop at {token!r}, text={text!r}")
            break
    print("kept tokens:", kept)
    print("truncated at stop string:",
          criteria.should_stop(1, "Hello world</s>", 3))


def demo_sampling() -> None:
    print("\n=== 5) 温度对采样分布的影响（20 次） ===")
    for temp in [0.5, 1.5]:
        rng = make_rng(42)
        params = SamplingParams(temperature=temp, top_k=0, top_p=1.0)
        counts = Counter()
        for _ in range(20):
            token = sample_token(BASE_LOGITS, params, [], rng)
            counts[LABELS[token]] += 1
        print(f"T={temp}: {dict(counts)}")


def main() -> None:
    demo_distribution()
    demo_penalties()
    demo_stop()
    demo_sampling()


if __name__ == "__main__":
    main()

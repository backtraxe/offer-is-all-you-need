"""MiniEngine v3：把连续 KV 数组换成 PagedAttention 的 block 管理。

演示四件事：
1. 单请求下，paged KV 与 v1 的连续 KV 输出完全一致；
2. 一个请求的 block table 怎么随 token 增长；
3. 两个请求 fork 同一段前缀时，完整 block 共享、引用计数 +1；
4. 请求结束后 block 归还，显存可被下一个请求复用。
"""

from __future__ import annotations

import numpy as np

from block_manager import BlockManager, PagedKVCache
from mini_engine_v1 import EOS_ID, HybridModel, TOKEN_TO_ID, VOCAB, generate_cached, Request


class PagedAttentionModel:
    """复用 HybridModel 的权重与 attention，只把 KV 存储换成 paged。"""

    def __init__(self, model: HybridModel, manager: BlockManager) -> None:
        self.model = model
        self.manager = manager

    def prefill(self, token_ids: list[int]) -> tuple[np.ndarray, PagedKVCache]:
        x = self.model._x(token_ids)
        k, v = self.model._kv(x)
        cache = PagedKVCache(self.manager)
        cache.append(k, v)
        k_all, v_all = cache.gather()
        logits = (
            self.model.bigram[token_ids[-1]]
            + 0.1 * self.model._head(x, k_all, v_all)[-1]
        )
        return logits, cache

    def decode(self, token_id: int, cache: PagedKVCache) -> tuple[np.ndarray, PagedKVCache]:
        pos = cache.length
        x = self.model._x([token_id], start=pos)
        k_new, v_new = self.model._kv(x)
        cache.append(k_new, v_new)
        k_all, v_all = cache.gather()
        logits = (
            self.model.bigram[token_id]
            + 0.1 * self.model._head(x, k_all, v_all)[-1]
        )
        return logits, cache


def generate_paged(
    model: PagedAttentionModel,
    prompt: list[str],
    max_new_tokens: int = 8,
) -> tuple[list[str], PagedKVCache]:
    ids = [TOKEN_TO_ID[t] for t in prompt]
    logits, cache = model.prefill(ids)
    out: list[str] = []
    for _ in range(max_new_tokens):
        next_id = int(np.argmax(logits))
        out.append(VOCAB[next_id])
        if next_id == EOS_ID:
            break
        logits, cache = model.decode(next_id, cache)
    return out, cache


def demo_single_request() -> None:
    print("\n=== 1) 单请求：v1 连续 KV vs v3 paged KV ===")
    prompt = ["<bos>", "the", "cat"]
    full_model = HybridModel(seed=0)
    v1 = generate_cached(full_model, Request(prompt, max_new_tokens=8))

    manager = BlockManager(num_blocks=32, block_size=4, dim=16)
    paged_model = PagedAttentionModel(HybridModel(seed=0), manager)
    v3_tokens, cache = generate_paged(paged_model, prompt, max_new_tokens=8)

    print("v1:", v1.output_tokens)
    print("v3:", v3_tokens)
    print("identical:", v1.output_tokens == v3_tokens)
    print("v3 block_table:", cache.block_table, "length:", cache.length)
    print("manager:", manager.stats())
    cache.free()
    print("after free:", manager.stats())


def demo_prefix_share() -> None:
    print("\n=== 2) 前缀共享：fork 完整 block，引用计数 +1 ===")
    manager = BlockManager(num_blocks=32, block_size=4, dim=16)
    model = PagedAttentionModel(HybridModel(seed=0), manager)
    # 8 个 token，正好 2 个完整 block（block_size=4）
    prompt = ["<bos>", "the", "cat", "sat", "on", "mat", ".", "the"]
    ids = [TOKEN_TO_ID[t] for t in prompt]

    logits_a, cache_a = model.prefill(ids)
    logits_b, cache_b = logits_a, cache_a.fork()
    print("prompt length:", len(ids))
    print("cache_a blocks:", cache_a.block_table)
    print("cache_b blocks:", cache_b.block_table)
    print("ref_count after fork:",
          {bid: manager.ref_count[bid] for bid in cache_a.block_table})

    # 两个请求各 decode 一步，分别拿到自己的新 block
    next_a = int(np.argmax(logits_a))
    next_b = int(np.argmax(logits_b))
    _, cache_a = model.decode(next_a, cache_a)
    _, cache_b = model.decode(next_b, cache_b)
    print("after decode:")
    print("  cache_a blocks:", cache_a.block_table)
    print("  cache_b blocks:", cache_b.block_table)
    print("  manager:", manager.stats())

    cache_a.free()
    print("after free cache_a:",
          {bid: manager.ref_count[bid] for bid in cache_b.block_table})
    cache_b.free()
    print("after free both:", manager.stats())


def demo_oom() -> None:
    print("\n=== 3) block 用尽：显存不足时显式报错 ===")
    manager = BlockManager(num_blocks=4, block_size=4, dim=16)
    held = manager.allocate(4)
    print("allocated:", held, "stats:", manager.stats())
    try:
        manager.allocate(1)
    except MemoryError as exc:
        print("expected MemoryError:", exc)
    manager.free(held)
    print("after free:", manager.stats())


def main() -> None:
    demo_single_request()
    demo_prefix_share()
    demo_oom()


if __name__ == "__main__":
    main()

"""MiniEngine v4：RadixCache 前缀缓存。

在 v3 的 PagedAttention 之上，自动复用「已经算过的前缀 block」：
- 同一个 prompt 第二次进来：命中全部 prefix，prefill 0 token；
- 共享前 4 token、后面分叉：命中 1 个 block，只算后缀；
- 请求结束后释放自己的 cache，RadixCache 继续持有 cached block；
- 显存紧张时按 LRU evict。
"""

from __future__ import annotations

import numpy as np

from block_manager import BlockManager
from mini_engine_v1 import EOS_ID, HybridModel, TOKEN_TO_ID, VOCAB
from mini_engine_v3 import PagedAttentionModel
from prefix_cache import RadixCache


class CachedPagedModel(PagedAttentionModel):
    def prefill_with_prefix(
        self, token_ids: list[int], radix: RadixCache
    ) -> tuple[np.ndarray, object, int]:
        matched, cache = radix.match(token_ids)
        if cache is None:
            logits, cache = super().prefill(token_ids)
            radix.insert(token_ids, cache)
            return logits, cache, 0

        if matched == len(token_ids):
            # 全部命中：用最后一个 token 的 query 去读 cached K/V
            x = self.model._x([token_ids[-1]], start=len(token_ids) - 1)
            k_all, v_all = cache.gather()
            logits = (
                self.model.bigram[token_ids[-1]]
                + 0.1 * self.model._head(x, k_all, v_all)[-1]
            )
        else:
            # 部分命中：只算 suffix
            suffix = token_ids[matched:]
            x = self.model._x(suffix, start=matched)
            k_new, v_new = self.model._kv(x)
            cache.append(k_new, v_new)
            k_all, v_all = cache.gather()
            logits = (
                self.model.bigram[token_ids[-1]]
                + 0.1 * self.model._head(x, k_all, v_all)[-1]
            )

        radix.insert(token_ids, cache)
        return logits, cache, matched


def generate_with_prefix(
    model: CachedPagedModel,
    radix: RadixCache,
    prompt: list[str],
    max_new_tokens: int = 8,
) -> tuple[list[str], int, int]:
    ids = [TOKEN_TO_ID[t] for t in prompt]
    logits, cache, matched = model.prefill_with_prefix(ids, radix)
    prefill_tokens = len(ids) - matched
    out: list[str] = []
    for _ in range(max_new_tokens):
        next_id = int(np.argmax(logits))
        out.append(VOCAB[next_id])
        if next_id == EOS_ID:
            break
        logits, cache = model.decode(next_id, cache)
    cache.free()
    return out, matched, prefill_tokens


def main() -> None:
    manager = BlockManager(num_blocks=64, block_size=4, dim=16)
    radix = RadixCache(block_size=4)
    model = CachedPagedModel(HybridModel(seed=0), manager)

    shared = ["<bos>", "the", "cat", "sat", "on", "mat", ".", "the"]
    diverged = ["<bos>", "the", "cat", "sat", "a", "dog", "ran", "away"]

    print("=== 1) 第一次请求：prefix 未命中 ===")
    out_a, matched_a, prefill_a = generate_with_prefix(model, radix, shared)
    print(f"output={out_a}, matched={matched_a}, prefill_tokens={prefill_a}")

    print("\n=== 2) 相同 prompt 第二次：全命中 ===")
    out_b, matched_b, prefill_b = generate_with_prefix(model, radix, shared)
    print(f"output={out_b}, matched={matched_b}, prefill_tokens={prefill_b}")
    print("outputs identical:", out_a == out_b)

    print("\n=== 3) 共享 4 token、后 4 token 分叉：部分命中 ===")
    out_c, matched_c, prefill_c = generate_with_prefix(model, radix, diverged)
    print(f"output={out_c}, matched={matched_c}, prefill_tokens={prefill_c}")

    print("\n=== 4) RadixTree 与显存状态 ===")
    radix.dump()
    print(radix.stats())
    print("manager:", manager.stats())

    print("\n=== 5) LRU evict 2 个 block ===")
    freed = radix.evict(2)
    print(f"freed={freed}, {radix.stats()}, manager={manager.stats()}")


if __name__ == "__main__":
    main()

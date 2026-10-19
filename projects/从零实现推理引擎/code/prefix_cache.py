"""Block 级 RadixCache 的最小实现。

把 token 序列按 block_size 切成 block key，用一棵压缩前缀树缓存
「已经算过的 KV block」：

- match：沿树走，返回最长的、带 cache 的前缀；
- insert：把请求的 cache fork 一份挂到树节点上；
- evict：按 LRU 释放没有被请求引用的 cached block。

真实 SGLang/vLLM 的 radix tree 是 token 粒度、带 page 映射与驱逐策略；
这里用 block 粒度 + fork 引用计数，保留最关键的机制。
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from block_manager import PagedKVCache


@dataclass
class RadixNode:
    key: tuple[int, ...] = ()
    children: dict[tuple[int, ...], "RadixNode"] = field(default_factory=dict)
    cache: PagedKVCache | None = None
    last_access: float = 0.0
    pinned: int = 0


class RadixCache:
    def __init__(self, block_size: int) -> None:
        self.block_size = block_size
        self.root = RadixNode()
        self.hits = 0
        self.misses = 0
        self.evictions = 0
        self.cached_blocks = 0

    def _block_keys(self, token_ids: list[int]) -> list[tuple[int, ...]]:
        b = self.block_size
        return [
            tuple(token_ids[i:i + b])
            for i in range(0, len(token_ids) - b + 1, b)
        ]

    def _find_cached(self, node: RadixNode) -> RadixNode | None:
        """在子树里找任意一个带 cache 的后代。

        后代 cache 一定包含共同祖先的完整 block（insert 时用的是
        cache.fork()），所以可以用 fork_prefix 截出祖先前缀。
        """
        if node.cache is not None:
            return node
        for child in node.children.values():
            found = self._find_cached(child)
            if found is not None:
                return found
        return None

    def match(self, token_ids: list[int]) -> tuple[int, PagedKVCache | None]:
        """返回 (命中 token 数, 可直接使用的 fork cache)。

        只缓存完整 block；尾部不足一个 block 的部分不参与命中。
        分叉场景：当前节点自身没 cache，但子树里有，则用子树 cache
        的 fork_prefix 截出当前前缀。
        """
        keys = self._block_keys(token_ids)
        node = self.root
        best_cache: RadixNode | None = None
        best_blocks = 0
        for i, key in enumerate(keys):
            if key not in node.children:
                break
            node = node.children[key]
            cached = self._find_cached(node)
            if cached is not None:
                best_cache = cached
                best_blocks = i + 1
        if best_cache is None:
            self.misses += 1
            return 0, None
        self.hits += 1
        best_cache.last_access = time.time()
        return best_blocks * self.block_size, best_cache.cache.fork_prefix(best_blocks)

    def insert(self, token_ids: list[int], cache: PagedKVCache) -> int:
        """把 cache fork 一份挂到树上；返回新增的 cached block 数。"""
        keys = self._block_keys(token_ids)
        if not keys:
            return 0
        node = self.root
        for key in keys:
            if key not in node.children:
                node.children[key] = RadixNode(key=key)
            node = node.children[key]
        if node.cache is not None:
            node.last_access = time.time()
            return 0
        node.cache = cache.fork()
        node.last_access = time.time()
        added = len(node.cache.block_table)
        self.cached_blocks += added
        return added

    def evict(self, num_blocks: int) -> int:
        """按 LRU 释放 cached block；返回实际释放的 block 数。"""
        nodes: list[RadixNode] = []

        def walk(node: RadixNode) -> None:
            if node.cache is not None and node.pinned == 0:
                nodes.append(node)
            for child in node.children.values():
                walk(child)

        walk(self.root)
        nodes.sort(key=lambda n: n.last_access)
        freed = 0
        for node in nodes:
            if freed >= num_blocks:
                break
            assert node.cache is not None
            freed += len(node.cache.block_table)
            node.cache.free()
            node.cache = None
            self.evictions += 1
        self.cached_blocks -= freed
        return freed

    def stats(self) -> str:
        return (
            f"hits={self.hits}, misses={self.misses}, "
            f"cached_blocks={self.cached_blocks}, evictions={self.evictions}"
        )

    def dump(self) -> None:
        def walk(node: RadixNode, depth: int = 0) -> None:
            if node.key:
                flag = "C" if node.cache is not None else "-"
                print("  " * depth + f"{node.key} [{flag}]")
            for child in node.children.values():
                walk(child, depth + 1)

        print("radix tree:")
        walk(self.root)

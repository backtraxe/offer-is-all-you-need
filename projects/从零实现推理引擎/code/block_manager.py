"""PagedAttention 的最小教学实现：BlockManager + PagedKVCache。

真实引擎的 block 是 GPU 上的一块显存；这里用 numpy 数组模拟。
关键不是性能，而是三件事：
1. KV 按固定大小 block 分配，不再要求连续；
2. 每个请求维护一张 block table（逻辑块 -> 物理块）；
3. 引用计数让多个请求共享同一段前缀，最后一个引用释放时才回收。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Block:
    k: np.ndarray
    v: np.ndarray
    length: int = 0


class BlockManager:
    def __init__(self, num_blocks: int, block_size: int, dim: int) -> None:
        self.num_blocks = num_blocks
        self.block_size = block_size
        self.dim = dim
        self.free_blocks: list[int] = list(range(num_blocks))
        self.ref_count: dict[int, int] = {i: 0 for i in range(num_blocks)}
        self.blocks: dict[int, Block] = {
            i: Block(
                k=np.zeros((block_size, dim), dtype=np.float64),
                v=np.zeros((block_size, dim), dtype=np.float64),
            )
            for i in range(num_blocks)
        }
        self.peak_used = 0

    # ---------- 分配 / 回收 ----------
    def allocate(self, n: int = 1) -> list[int]:
        if n <= 0:
            return []
        if len(self.free_blocks) < n:
            raise MemoryError(
                f"KV pool exhausted: need {n}, free {len(self.free_blocks)}"
            )
        ids = [self.free_blocks.pop(0) for _ in range(n)]
        for bid in ids:
            self.ref_count[bid] = 1
            self.blocks[bid].length = 0
        self.peak_used = max(self.peak_used, self.used_blocks)
        return ids

    def free(self, block_ids: list[int]) -> None:
        for bid in block_ids:
            if self.ref_count[bid] <= 0:
                raise ValueError(f"block {bid} is already free")
            self.ref_count[bid] -= 1
            if self.ref_count[bid] == 0:
                self.blocks[bid].length = 0
                self.free_blocks.append(bid)

    def fork(self, block_ids: list[int]) -> None:
        """共享一段前缀：只增加引用计数，不复制数据。"""
        for bid in block_ids:
            if self.ref_count[bid] <= 0:
                raise ValueError(f"cannot fork free block {bid}")
            self.ref_count[bid] += 1

    @property
    def used_blocks(self) -> int:
        return self.num_blocks - len(self.free_blocks)

    def stats(self) -> str:
        return (
            f"used={self.used_blocks}/{self.num_blocks}, "
            f"free={len(self.free_blocks)}, peak={self.peak_used}"
        )


class PagedKVCache:
    """一个请求的 KV Cache：block table + 当前有效长度。"""

    def __init__(self, manager: BlockManager) -> None:
        self.manager = manager
        self.block_size = manager.block_size
        self.block_table: list[int] = []
        self.length = 0

    def append(self, k_new: np.ndarray, v_new: np.ndarray) -> None:
        """k_new / v_new: [n, dim]，逐 token 写入；块满就分配新块。"""
        if k_new.shape[0] != v_new.shape[0]:
            raise ValueError("k/v token count mismatch")
        for i in range(k_new.shape[0]):
            if self.length % self.block_size == 0:
                self.block_table.append(self.manager.allocate(1)[0])
            bid = self.block_table[-1]
            block = self.manager.blocks[bid]
            offset = block.length
            block.k[offset] = k_new[i]
            block.v[offset] = v_new[i]
            block.length += 1
            self.length += 1

    def gather(self) -> tuple[np.ndarray, np.ndarray]:
        """把分散的 block 拼成连续 K/V，供 toy attention 使用。

        真实 PagedAttention kernel 不会真的 gather，而是按 block table
        直接读显存；这里 gather 只是为了让 numpy 版 attention 能算。
        """
        if not self.block_table:
            return (
                np.zeros((0, self.manager.dim)),
                np.zeros((0, self.manager.dim)),
            )
        ks, vs = [], []
        for bid in self.block_table:
            block = self.manager.blocks[bid]
            ks.append(block.k[:block.length])
            vs.append(block.v[:block.length])
        return np.concatenate(ks, axis=0), np.concatenate(vs, axis=0)

    def fork_prefix(self, n_blocks: int) -> "PagedKVCache":
        """只共享前 n_blocks 个完整 block，用于分叉前缀命中。"""
        if n_blocks < 0 or n_blocks > len(self.block_table):
            raise ValueError("n_blocks out of range")
        child = PagedKVCache(self.manager)
        child.length = n_blocks * self.block_size
        for bid in self.block_table[:n_blocks]:
            block = self.manager.blocks[bid]
            if block.length != self.block_size:
                raise ValueError("fork_prefix only supports full blocks")
            self.manager.fork([bid])
            child.block_table.append(bid)
        return child

    def fork(self) -> "PagedKVCache":
        """复制一个请求的 cache（用于共享前缀）。

        完整 block 直接共享（引用计数 +1）；最后一个未填满的 block 复制，
        避免两个请求写同一个尾部 block 造成数据污染。
        """
        child = PagedKVCache(self.manager)
        child.length = self.length
        for bid in self.block_table:
            block = self.manager.blocks[bid]
            if block.length == self.block_size:
                self.manager.fork([bid])
                child.block_table.append(bid)
            else:
                new_bid = self.manager.allocate(1)[0]
                new_block = self.manager.blocks[new_bid]
                new_block.k[:block.length] = block.k[:block.length]
                new_block.v[:block.length] = block.v[:block.length]
                new_block.length = block.length
                child.block_table.append(new_bid)
        return child

    def free(self) -> None:
        self.manager.free(self.block_table)
        self.block_table = []
        self.length = 0

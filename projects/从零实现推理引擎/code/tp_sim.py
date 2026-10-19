"""Tensor Parallel 的最小教学模拟：列切、行切、all-reduce 通信量。

不是分布式实现，而是用 numpy 把「切什么、在哪通信」算清楚：
- Column Parallel：按输出维切 W，每个 rank 算一部分输出；
- Row Parallel：按输入维切 W，每个 rank 算部分和，最后 all-reduce；
- 两者拼成一个 MLP：h -> 4h（列切）-> h（行切）。
"""

from __future__ import annotations

import numpy as np


def column_parallel(x: np.ndarray, w: np.ndarray, world_size: int) -> np.ndarray:
    """x: [B, in], w: [in, out]；按 out 维切分，输出拼接。"""
    if w.shape[1] % world_size != 0:
        raise ValueError("out dim must be divisible by world_size")
    chunks = np.array_split(w, world_size, axis=1)
    partials = [np.dot(x, chunk) for chunk in chunks]
    return np.concatenate(partials, axis=1)


def row_parallel(x: np.ndarray, w: np.ndarray, world_size: int) -> np.ndarray:
    """x: [B, in], w: [in, out]；按 in 维切分，各 rank 算部分和后 all-reduce。"""
    if w.shape[0] % world_size != 0 or x.shape[1] % world_size != 0:
        raise ValueError("in dim must be divisible by world_size")
    x_chunks = np.array_split(x, world_size, axis=1)
    w_chunks = np.array_split(w, world_size, axis=0)
    partials = [np.dot(xc, wc) for xc, wc in zip(x_chunks, w_chunks)]
    # all-reduce(sum)：真实实现是 ring/tree，这里直接求和
    return np.sum(np.stack(partials, axis=0), axis=0)


def mlp_tp(x: np.ndarray, w1: np.ndarray, w2: np.ndarray, world_size: int) -> np.ndarray:
    """h -> 4h 列切，4h -> h 行切；中间一次 all-reduce。"""
    hidden = column_parallel(x, w1, world_size)
    hidden = np.maximum(hidden, 0.0)  # ReLU
    return row_parallel(hidden, w2, world_size)


def allreduce_bytes(
    batch: int, seq: int, hidden: int, bytes_per_elem: int, world_size: int
) -> int:
    """Ring all-reduce 的通信量：2 × (N-1)/N × 数据量。"""
    data = batch * seq * hidden * bytes_per_elem
    return int(2 * data * (world_size - 1) / world_size)


def main() -> None:
    rng = np.random.default_rng(0)
    batch, seq, hidden, inter = 2, 8, 16, 64
    world = 4
    x = rng.normal(0, 0.1, (batch * seq, hidden))
    w1 = rng.normal(0, 0.1, (hidden, inter))
    w2 = rng.normal(0, 0.1, (inter, hidden))

    ref_mlp = np.dot(np.maximum(np.dot(x, w1), 0), w2)
    tp_mlp = mlp_tp(x, w1, w2, world)
    print("=== 1) MLP 列切 + 行切 ===")
    print("ref shape:", ref_mlp.shape, "tp shape:", tp_mlp.shape)
    print("max |diff|:", float(np.max(np.abs(ref_mlp - tp_mlp))))

    print("\n=== 2) 单层列切 / 行切 ===")
    y_col = column_parallel(x, w1, world)
    print("column parallel max diff:", float(np.max(np.abs(np.dot(x, w1) - y_col))))
    y_row = row_parallel(x, w1, world)  # 这里 w1 的 in=hidden, out=inter
    print("row parallel max diff:", float(np.max(np.abs(np.dot(x, w1) - y_row))))

    print("\n=== 3) all-reduce 通信量（BF16） ===")
    for bs in [1, 8, 32]:
        nbytes = allreduce_bytes(bs, 2048, 4096, 2, world)
        print(f"B={bs:>2}, S=2048, H=4096, world={world}: "
              f"{nbytes / 1024 / 1024:.1f} MiB / layer")


if __name__ == "__main__":
    main()

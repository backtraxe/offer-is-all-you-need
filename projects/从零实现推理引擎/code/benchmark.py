"""MiniEngine benchmark：串行 vs 不同 batch size 的 TTFT/TPOT/吞吐。

复用 mini_engine_v2 的 workload 与调度器，数字是 CPU toy 口径，
用于讲清「怎么测、怎么看趋势」，不是 GPU 实测。
"""

from __future__ import annotations

from mini_engine_v2 import Request, run_continuous, run_serial, workload
from mini_engine_v1 import HybridModel


def summarize(name: str, reqs: list[Request], wall: float, calls: int) -> dict:
    total_out = sum(len(r.output_ids) for r in reqs)
    ttfts = sorted((r.first_token_time - r.start_time) * 1000 for r in reqs)
    tpots = [
        (r.finish_time - r.first_token_time) * 1000 / max(1, len(r.output_ids) - 1)
        for r in reqs
    ]
    p50_ttft = ttfts[len(ttfts) // 2]
    p50_tpot = sorted(tpots)[len(tpots) // 2]
    row = {
        "name": name,
        "calls": calls,
        "wall_ms": wall * 1000,
        "output_tokens": total_out,
        "throughput": total_out / wall,
        "ttft_p50": p50_ttft,
        "tpot_p50": p50_tpot,
    }
    print(
        f"{name:>12} | calls={calls:>2} | wall={row['wall_ms']:>7.2f}ms | "
        f"tok/s={row['throughput']:>7.1f} | "
        f"TTFT p50={p50_ttft:>6.2f}ms | TPOT p50={p50_tpot:>6.2f}ms"
    )
    return row


def main() -> None:
    delay_ms = 0.5
    print("=== serial baseline ===")
    serial_reqs, serial_wall, serial_calls = run_serial(
        HybridModel(seed=0), workload(), delay_ms
    )
    base = summarize("serial", serial_reqs, serial_wall, serial_calls)

    print("\n=== continuous batching, varying max_batch_size ===")
    rows = []
    for batch in [1, 2, 3, 6]:
        reqs, wall, calls = run_continuous(
            HybridModel(seed=0), workload(), delay_ms, max_batch_size=batch
        )
        row = summarize(f"batch={batch}", reqs, wall, calls)
        row["speedup"] = row["throughput"] / base["throughput"]
        rows.append(row)

    print("\n=== summary ===")
    print(f"{'config':>12} | {'speedup':>8} | {'tok/s':>8} | {'TTFT p50':>9} | {'TPOT p50':>9}")
    for row in [base] + rows:
        speedup = row.get("speedup", 1.0)
        print(
            f"{row['name']:>12} | {speedup:>7.2f}x | "
            f"{row['throughput']:>8.1f} | {row['ttft_p50']:>8.2f}ms | "
            f"{row['tpot_p50']:>8.2f}ms"
        )


if __name__ == "__main__":
    main()

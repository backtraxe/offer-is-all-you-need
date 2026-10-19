"""CUDA Graph 的 CPU 模拟 benchmark。

没有 GPU 也能看清两件事：
1. eager 每步要为每个 kernel 付一次 launch overhead；
2. graph 把「多次 launch」压成「一次 replay」，但 capture 本身有固定成本。

用 time.sleep 模拟 launch/compute，数字用于讲趋势，不是 GPU 实测。
"""

from __future__ import annotations

import time
from dataclasses import dataclass


def _sleep_ms(ms: float) -> None:
    if ms > 0:
        time.sleep(ms / 1000.0)


@dataclass
class Kernel:
    name: str
    compute_ms: float = 0.05


@dataclass
class GraphStats:
    capture_ms: float
    replay_launch_ms: float
    compute_ms: float


class EagerRunner:
    def __init__(self, kernels: list[Kernel], launch_ms: float = 0.05) -> None:
        self.kernels = kernels
        self.launch_ms = launch_ms

    def step(self) -> None:
        for kernel in self.kernels:
            _sleep_ms(self.launch_ms)   # CPU 发 kernel
            _sleep_ms(kernel.compute_ms)  # GPU 执行


class GraphRunner:
    def __init__(
        self,
        kernels: list[Kernel],
        launch_ms: float = 0.05,
        capture_ms: float = 5.0,
    ) -> None:
        self.kernels = kernels
        self.launch_ms = launch_ms
        self.capture_ms = capture_ms
        self.captured = False
        self.recaptures = 0

    def capture(self) -> None:
        _sleep_ms(self.capture_ms)
        self.captured = True

    def step(self) -> None:
        if not self.captured:
            self.capture()
        _sleep_ms(self.launch_ms)  # 一次 graph launch
        for kernel in self.kernels:
            _sleep_ms(kernel.compute_ms)  # 图内 kernel 仍要执行


def measure(runner, steps: int) -> float:
    start = time.perf_counter()
    for _ in range(steps):
        runner.step()
    return (time.perf_counter() - start) * 1000


def benchmark(
    kernels: list[Kernel],
    launch_ms: float = 0.05,
    capture_ms: float = 5.0,
    steps_list: list[int] | None = None,
) -> None:
    steps_list = steps_list or [1, 4, 16, 64, 256]
    n = len(kernels)
    compute_ms = sum(k.compute_ms for k in kernels)
    print(f"kernels={n}, launch={launch_ms}ms, compute={compute_ms:.2f}ms, "
          f"capture={capture_ms}ms")
    print(f"{'steps':>6} {'eager_ms':>10} {'graph_ms':>10} {'speedup':>8}")
    for steps in steps_list:
        eager = EagerRunner(kernels, launch_ms)
        eager_ms = measure(eager, steps)
        graph = GraphRunner(kernels, launch_ms, capture_ms)
        graph_ms = measure(graph, steps)
        print(f"{steps:>6} {eager_ms:>10.2f} {graph_ms:>10.2f} "
              f"{eager_ms / graph_ms:>7.2f}x")

    per_step_saving = n * launch_ms - launch_ms
    break_even = capture_ms / per_step_saving if per_step_saving > 0 else float("inf")
    print(f"\n单步节省≈{per_step_saving:.3f}ms, "
          f"break_even≈{break_even:.1f} steps")
    print("结论：短生成（步数 < break_even）graph 可能亏；长 decode 才赚。")


def dynamic_shape_demo() -> None:
    print("\n=== 动态 shape：batch 变化要重新 capture ===")
    kernels = [Kernel(f"k{i}") for i in range(8)]
    graph = GraphRunner(kernels, launch_ms=0.05, capture_ms=3.0)
    captured_shapes: set[int] = set()
    for batch in [1, 2, 4, 2, 1, 8, 1]:
        # 真实 CUDA Graph 需要 static shape；每个新 shape 要 capture 一次
        if batch not in captured_shapes:
            graph.capture()
            captured_shapes.add(batch)
            graph.recaptures += 1
        _ = measure(graph, 4)
        print(f"batch={batch}, captured_shapes={sorted(captured_shapes)}, "
              f"recaptures={graph.recaptures}")


def main() -> None:
    kernels = [Kernel(f"k{i}", compute_ms=0.05) for i in range(20)]
    benchmark(kernels, launch_ms=0.05, capture_ms=5.0)
    dynamic_shape_demo()


if __name__ == "__main__":
    main()

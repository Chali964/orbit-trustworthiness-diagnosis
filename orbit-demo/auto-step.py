#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动步长标定 —— 让程序自己找出合适的步长
=========================================================
这是「课题第二件事」的参考实现。

要解决的问题：
  固定步长积分器里，「步长该用多少」通常靠人反复试。
  我们希望改成：给一个误差阈值，程序自动找出满足要求的最快步长。

方向先说清楚（容易搞反）：
  步长越小 → 越准，但越慢；步长越大 → 越快，但越糙。
  所以「合适」= 在满足误差阈值的前提下，步长尽量大。
  我们要找的是【可用步长的上界】，不是最小步长。

本文件实现三种做法，并比较它们各自要试探多少次：
  ① 减半法      最直观：超标就减半，达标就停
  ② 二分法      在达标与不达标之间二分，逼近临界值
  ③ 阶数缩放法  最聪明：利用已知阶数 p 和「误差 ∝ h^p」直接算出该用多大

纯标准库实现。直接运行：python auto-step.py
"""

import math
import os

# ---------- 场景常量（与前面保持一致）----------
MU = 398600.4418
A = 7000.0
ECC = 0.05
ORBITS = 2

N_MEAN = math.sqrt(MU / A ** 3)
PERIOD = 2.0 * math.pi / N_MEAN


# ---------- 解析真值 ----------
def solve_kepler(M, e, tol=1e-13, itmax=80):
    M = math.fmod(M, 2.0 * math.pi)
    if M < 0:
        M += 2.0 * math.pi
    E = M if e < 0.8 else math.pi
    for _ in range(itmax):
        d = (E - e * math.sin(E) - M) / (1.0 - e * math.cos(E))
        E -= d
        if abs(d) < tol:
            break
    return E


def exact_state(t):
    E = solve_kepler(N_MEAN * t, ECC)
    cE, sE = math.cos(E), math.sin(E)
    Edot = N_MEAN / (1.0 - ECC * cE)
    return (A * (cE - ECC),
            A * math.sqrt(1.0 - ECC ** 2) * sE,
            -A * sE * Edot,
            A * math.sqrt(1.0 - ECC ** 2) * cE * Edot)


def deriv(s):
    x, y, vx, vy = s
    r3 = (x * x + y * y) ** 1.5
    return [vx, vy, -MU * x / r3, -MU * y / r3]


def rk4_step(s, dt):
    k1 = deriv(s)
    k2 = deriv([s[i] + 0.5 * dt * k1[i] for i in range(4)])
    k3 = deriv([s[i] + 0.5 * dt * k2[i] for i in range(4)])
    k4 = deriv([s[i] + dt * k3[i] for i in range(4)])
    return [s[i] + dt / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(4)]


# ---------- 核心工具：给定步长，测出误差 ----------
COUNTER = {"n": 0}          # 统计「试探次数」——每测一次误差算一次


def measure_error(stepper, dt, orbits=ORBITS):
    """按步长 dt 递推，返回末态位置误差(km)。每调用一次计数 +1。"""
    COUNTER["n"] += 1
    n_steps = int(round(orbits * PERIOD / dt))
    s = list(exact_state(0.0))
    for _ in range(n_steps):
        s = stepper(s, dt)
    ex, ey, _, _ = exact_state(n_steps * dt)
    return math.hypot(s[0] - ex, s[1] - ey)


# ---------- 做法 ①：减半法 ----------
def search_by_halving(stepper, target, dt0):
    """超标就把步长减半，达标就停。最直观，但结果偏保守。"""
    dt = dt0
    for _ in range(40):
        err = measure_error(stepper, dt)
        if err <= target:
            return dt, err
        dt = dt * 0.5
    return dt, err


# ---------- 做法 ③：阶数缩放法 ----------
def search_by_order_scaling(stepper, order, target, dt0, max_iter=12):
    """用「误差 ∝ h^阶数」直接算出该用多大步长，再验证。

    h_new = h_old × (目标误差 / 当前误差)^(1/阶数)
    """
    dt = dt0
    err = measure_error(stepper, dt)
    for _ in range(max_iter):
        if err <= target:
            return dt, err
        ratio = target / err
        dt = dt * ratio ** (1.0 / order)
        err = measure_error(stepper, dt)
    return dt, err


# ---------- 做法 ②：二分法（在 ① 或 ③ 的结果上精细化）----------
def refine_by_bisection(stepper, target, dt_ok, dt_bad, rounds=10):
    """dt_ok 是达标步长，dt_bad 是不达标步长。在两者之间二分，逼近临界步长。"""
    for _ in range(rounds):
        mid = 0.5 * (dt_ok + dt_bad)
        err = measure_error(stepper, mid)
        if err <= target:
            dt_ok = mid
        else:
            dt_bad = mid
    return dt_ok, measure_error(stepper, dt_ok)


def main():
    print("=" * 80)
    print("自动步长标定：给定误差阈值，程序自己找出可用的最快步长")
    print("=" * 80)
    print("场景：a=%.0f km, e=%.3f, 积分 %d 圈；方法 RK4（4 阶）；真值=开普勒解析解" % (A, ECC, ORBITS))
    print("周期 T = %.1f s" % PERIOD)
    print("说明：步长越大越省时间，所以「合适」= 满足误差阈值的前提下尽量大。")
    print()

    targets = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6]
    dt0 = PERIOD / 100.0        # 初始试探步长：每圈 100 步

    print("-" * 80)
    print("做法 ① 减半法")
    print("-" * 80)
    print("%-14s %-14s %-12s %-14s %s" % ("误差阈值(km)", "可用步长(s)", "每圈步数", "实测误差(km)", "试探次数"))
    halving = []
    for t in targets:
        COUNTER["n"] = 0
        dt, err = search_by_halving(rk4_step, t, dt0)
        halving.append((t, dt, err, COUNTER["n"]))
        print("%-14.0e %-14.4f %-12.0f %-14.3e %d" % (t, dt, PERIOD / dt, err, COUNTER["n"]))
    print()

    print("-" * 80)
    print("做法 ③ 阶数缩放法（利用已知的阶数 4）")
    print("-" * 80)
    print("%-14s %-14s %-12s %-14s %s" % ("误差阈值(km)", "可用步长(s)", "每圈步数", "实测误差(km)", "试探次数"))
    scaling = []
    for t in targets:
        COUNTER["n"] = 0
        dt, err = search_by_order_scaling(rk4_step, 4, t, dt0)
        scaling.append((t, dt, err, COUNTER["n"]))
        print("%-14.0e %-14.4f %-12.0f %-14.3e %d" % (t, dt, PERIOD / dt, err, COUNTER["n"]))
    print()

    print("-" * 80)
    print("做法 ② 在缩放法结果上再做二分精细化（逼近真正的临界步长）")
    print("-" * 80)
    print("%-14s %-14s %-12s %-14s %s" % ("误差阈值(km)", "临界步长(s)", "每圈步数", "实测误差(km)", "总试探次数"))
    refined = []
    for (t, dt, err, _n) in scaling:
        COUNTER["n"] = 0
        dt_ok, err_ok = refine_by_bisection(rk4_step, t, dt, dt * 1.6, rounds=10)
        refined.append((t, dt_ok, err_ok, COUNTER["n"]))
        print("%-14.0e %-14.4f %-12.0f %-14.3e %d" % (t, dt_ok, PERIOD / dt_ok, err_ok, COUNTER["n"]))
    print()

    print("=" * 80)
    print("三种做法的对比")
    print("=" * 80)
    print("%-14s %-16s %-16s %-16s" % ("误差阈值(km)", "减半法试探次数", "缩放法试探次数", "精细化后步长增益"))
    print("-" * 80)
    for (t, dh, _, nh), (t2, ds, _, ns), (t3, dr, _, nr) in zip(halving, scaling, refined):
        gain = (dr / ds - 1.0) * 100.0
        print("%-14.0e %-16d %-16d %+.1f%%" % (t, nh, ns, gain))
    print()
    print("结论：")
    print("  · 缩放法用更少的试探次数拿到同等精度 —— 因为它利用了已知的阶数。")
    print("  · 二分精细化能把步长再往上推一点（上表最后一列），代价是多次试探。")
    print("  · 这就是「阶数」的第二重用途：不仅用来验证程序对不对，还能直接算出该用多大步长。")
    print()
    print("一个专业提醒：步长也不能无限缩小。")
    print("  步长太大会有截断误差；步长太小，机器浮点舍入误差会开始累积，误差反而回升。")
    print("  所以严格说输出的是一个【可用步长区间】，而不是单向的「越小越好」。本文件演示的是上界一侧。")

    # 写 CSV
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "auto-step.csv")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.write("target_err_km,halving_dt_s,halving_tries,scaling_dt_s,scaling_tries,refined_dt_s,refined_err_km,refined_tries\n")
        for (t, dh, _, nh), (_, ds, _, ns), (_, dr, er, nr) in zip(halving, scaling, refined):
            f.write("%.0e,%.6f,%d,%.6f,%d,%.6f,%.6e,%d\n" % (t, dh, nh, ds, ns, dr, er, nr))
    print()
    print("已写出：", path)


if __name__ == "__main__":
    main()

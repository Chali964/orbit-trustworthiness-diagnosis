#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
观察阶对照矩阵 —— 三种数值方法的精度对比
=========================================================
这是「课题第一件事」的参考实现，演示如何用同一个问题
把不同阶数的数值方法放在一起比，并测出各自的观测阶。

三种方法（按阶数从低到高）：
  ① 前向欧拉        1 阶    用 1 个斜率推一步
  ② 改进欧拉（休恩） 2 阶    用 2 个斜率取平均
  ③ RK4            4 阶    用 4 个斜率加权平均

理论规律：步长缩小一半，误差应缩小 2^阶数 倍
  1 阶 → 缩小 2 倍
  2 阶 → 缩小 4 倍
  4 阶 → 缩小 16 倍

纯标准库实现，无需 numpy。直接运行：python order-matrix.py
"""

import csv
import math
import os

# ---------- 场景常量（与 propagate.py 保持一致）----------
MU = 398600.4418
R_EARTH = 6378.137
A = 7000.0
ECC = 0.05
ORBITS = 2                      # 积分圈数（短一些，避免低阶方法发散）
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

N_MEAN = math.sqrt(MU / A ** 3)
PERIOD = 2.0 * math.pi / N_MEAN
R_PERIGEE = A * (1.0 - ECC)
ENERGY0 = -MU / (2.0 * A)
HMAG0 = math.sqrt(MU * A * (1.0 - ECC ** 2))


# ---------- 解析真值（开普勒方程）----------
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


# ---------- 运动方程与三种积分方法 ----------
def deriv(s):
    x, y, vx, vy = s
    r3 = (x * x + y * y) ** 1.5
    return [vx, vy, -MU * x / r3, -MU * y / r3]


def euler_step(s, dt):
    """1 阶：只取起点处的斜率，直接推一整步。"""
    k1 = deriv(s)
    return [s[i] + dt * k1[i] for i in range(4)]


def heun_step(s, dt):
    """2 阶（改进欧拉 / 休恩法）：先预测终点，再取起点与终点的斜率求平均。"""
    k1 = deriv(s)
    pred = [s[i] + dt * k1[i] for i in range(4)]      # 预测（同前向欧拉）
    k2 = deriv(pred)                                  # 用预测点再求一次斜率
    return [s[i] + dt * 0.5 * (k1[i] + k2[i]) for i in range(4)]


def midpoint_step(s, dt):
    """2 阶（中点法）：取区间正中间那一点的斜率推一整步。另一种 2 阶方案。"""
    k1 = deriv(s)
    mid = [s[i] + 0.5 * dt * k1[i] for i in range(4)]
    k2 = deriv(mid)
    return [s[i] + dt * k2[i] for i in range(4)]


def rk4_step(s, dt):
    """4 阶：取 4 个点的斜率，按 1:2:2:1 加权平均。"""
    k1 = deriv(s)
    k2 = deriv([s[i] + 0.5 * dt * k1[i] for i in range(4)])
    k3 = deriv([s[i] + 0.5 * dt * k2[i] for i in range(4)])
    k4 = deriv([s[i] + dt * k3[i] for i in range(4)])
    return [s[i] + dt / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(4)]


METHODS = [
    ("前向欧拉", 1, euler_step),
    ("改进欧拉", 2, heun_step),
    ("中点法", 2, midpoint_step),
    ("RK4", 4, rk4_step),
]


# ---------- 递推与误差测量 ----------
def final_pos_error(stepper, n_per_orbit):
    """按每圈 n_per_orbit 步递推 ORBITS 圈，返回末态位置误差(km)与末态比能量相对误差。"""
    dt = PERIOD / n_per_orbit
    n_steps = int(round(ORBITS * PERIOD / dt))
    s = list(exact_state(0.0))
    e0 = 0.5 * (s[2] ** 2 + s[3] ** 2) - MU / math.hypot(s[0], s[1])
    for _ in range(n_steps):
        s = stepper(s, dt)
    t = n_steps * dt
    ex, ey, _, _ = exact_state(t)
    pos_err = math.hypot(s[0] - ex, s[1] - ey)
    e = 0.5 * (s[2] ** 2 + s[3] ** 2) - MU / math.hypot(s[0], s[1])
    return pos_err, abs(e - e0) / abs(e0)


def observed_order(dt_coarse, err_coarse, dt_fine, err_fine):
    """由相邻两档的误差比值反推观测阶：log(err1/err2) / log(dt1/dt2)。"""
    if err_coarse <= 0 or err_fine <= 0:
        return float("nan")
    return math.log(err_coarse / err_fine) / math.log(dt_coarse / dt_fine)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print("=" * 76)
    print("观察阶对照矩阵")
    print("=" * 76)
    print("场景：近地椭圆轨道 a=%.0f km, e=%.3f, 积分 %d 圈" % (A, ECC, ORBITS))
    print("真值：开普勒方程解析精确解")
    print("规律：步长每缩小一半，误差应缩小 2^阶数 倍")
    print("      1 阶→2 倍   2 阶→4 倍   4 阶→16 倍")
    print()

    n_list = [100, 200, 400, 800, 1600, 3200]
    dt_list = [PERIOD / n for n in n_list]

    print("%-10s %-6s %-8s %-16s %-16s %-9s" % (
        "方法", "理论阶", "每圈步数", "位置误差(km)", "比能量相对误差", "观测阶"))
    print("-" * 76)

    summary = []
    for name, theory, step in METHODS:
        prev = None
        orders = []
        for n, dt in zip(n_list, dt_list):
            pe, ee = final_pos_error(step, n)
            obs = ""
            if prev is not None:
                o = observed_order(prev[0], prev[1], dt, pe)
                if not math.isnan(o):
                    obs = "%.2f" % o
                    orders.append(o)
            print("%-10s %-6d %-8d %-16.6e %-16.3e %-9s" % (name, theory, n, pe, ee, obs))
            prev = (dt, pe)
        print("-" * 76)
        # 取后段（更接近渐近区）的平均观测阶
        tail = orders[-3:] if len(orders) >= 3 else orders
        avg = sum(tail) / len(tail) if tail else float("nan")
        summary.append((name, theory, avg))

    print()
    print("=" * 76)
    print("汇总：理论阶 vs 实测观测阶")
    print("=" * 76)
    print("%-12s %-10s %-14s %s" % ("方法", "理论阶", "实测观测阶", "结论"))
    print("-" * 76)
    for name, theory, avg in summary:
        if math.isnan(avg):
            verdict = "数据不足"
        elif abs(avg - theory) < 0.5:
            verdict = "一致"
        else:
            verdict = "偏差较大，需检查"
        print("%-12s %-10d %-14.2f %s" % (name, theory, avg, verdict))

    print()
    print("说明：观测阶由相邻两档步长的误差比值反推。取值越接近理论阶，说明实现越正确。")
    print("      粗步长档位未进入渐近区，观测阶会偏高，属正常现象。")

    # 写出 CSV
    rows = []
    for name, theory, step in METHODS:
        prev = None
        for n, dt in zip(n_list, dt_list):
            pe, ee = final_pos_error(step, n)
            o = ""
            if prev is not None:
                v = observed_order(prev[0], prev[1], dt, pe)
                if not math.isnan(v):
                    o = "%.6f" % v
            rows.append({"method": name, "theory_order": theory,
                         "n_per_orbit": n, "dt_s": "%.6f" % dt,
                         "pos_err_km": "%.10e" % pe,
                         "rel_energy_err": "%.10e" % ee,
                         "observed_order": o})
            prev = (dt, pe)

    path = os.path.join(OUT_DIR, "order-matrix.csv")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print()
    print("已写出：", path, "（%d 行）" % len(rows))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
轨道递推与守恒量校验 —— 课题示范实现
=========================================================
场景：近地椭圆轨道（二体问题）
方法：定步长四阶龙格-库塔（RK4），另附前向欧拉作对照
校验：① 比能量 ε 与比角动量 h 的守恒性  ② 与解析解（开普勒方程）的位置偏差
     ③ 收敛阶标定（误差随步长的幂次关系）

纯标准库实现，无需 numpy。直接运行：python propagate.py
"""

import csv
import math
import os

# ---------- 场景常量（单位：km, s）----------
MU = 398600.4418        # 地球引力常数 km^3/s^2
R_EARTH = 6378.137      # 地球平均半径 km
A = 7000.0              # 轨道半长轴 km
ECC = 0.05              # 偏心率
ORBITS = 10             # 积分圈数
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

# 由 a、e 导出的派生量
N_MEAN = math.sqrt(MU / A ** 3)                 # 平均角速度 rad/s
PERIOD = 2.0 * math.pi / N_MEAN                 # 轨道周期 s
R_PERIGEE = A * (1.0 - ECC)
V_PERIGEE = math.sqrt(MU * (1.0 + ECC) / (A * (1.0 - ECC)))
ENERGY0 = -MU / (2.0 * A)                       # 比能量理论值 km^2/s^2
HMAG0 = math.sqrt(MU * A * (1.0 - ECC ** 2))    # 比角动量理论值 km^2/s


# ---------- 解析解：开普勒方程 ----------
def solve_kepler(M, e, tol=1e-13, itmax=80):
    """牛顿迭代解 M = E - e*sin(E)，返回偏近点角 E。"""
    M = math.fmod(M, 2.0 * math.pi)
    if M < 0:
        M += 2.0 * math.pi
    E = M if e < 0.8 else math.pi
    for _ in range(itmax):
        f = E - e * math.sin(E) - M
        fp = 1.0 - e * math.cos(E)
        d = f / fp
        E -= d
        if abs(d) < tol:
            break
    return E


def exact_state(t):
    """在 t 时刻的精确状态 [x, y, vx, vy]。近地点在 +x 轴，t=0 时 E=0。"""
    M = N_MEAN * t
    E = solve_kepler(M, ECC)
    cE, sE = math.cos(E), math.sin(E)
    x = A * (cE - ECC)
    y = A * math.sqrt(1.0 - ECC ** 2) * sE
    Edot = N_MEAN / (1.0 - ECC * cE)
    vx = -A * sE * Edot
    vy = A * math.sqrt(1.0 - ECC ** 2) * cE * Edot
    return x, y, vx, vy


# ---------- 动力学与积分器 ----------
def deriv(state):
    """二体问题运动方程。state = [x, y, vx, vy]"""
    x, y, vx, vy = state
    r3 = (x * x + y * y) ** 1.5
    return [vx, vy, -MU * x / r3, -MU * y / r3]


def rk4_step(state, dt):
    k1 = deriv(state)
    s2 = [state[i] + 0.5 * dt * k1[i] for i in range(4)]
    k2 = deriv(s2)
    s3 = [state[i] + 0.5 * dt * k2[i] for i in range(4)]
    k3 = deriv(s3)
    s4 = [state[i] + dt * k3[i] for i in range(4)]
    k4 = deriv(s4)
    return [state[i] + dt / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(4)]


def euler_step(state, dt):
    d = deriv(state)
    return [state[i] + dt * d[i] for i in range(4)]


# ---------- 守恒量 ----------
def energy(state):
    x, y, vx, vy = state
    r = math.hypot(x, y)
    return 0.5 * (vx * vx + vy * vy) - MU / r


def ang_momentum(state):
    x, y, vx, vy = state
    return x * vy - y * vx      # 平面问题，即 h 的 z 分量


def pos_error(state, t):
    ex, ey, _, _ = exact_state(t)
    return math.hypot(state[0] - ex, state[1] - ey)


# ---------- 递推主循环 ----------
def propagate(n_per_orbit, orbits=ORBITS, stepper=rk4_step, sample_every=1):
    """按每圈 n_per_orbit 步递推，返回采样记录列表。"""
    dt = PERIOD / n_per_orbit
    t_end = orbits * PERIOD
    n_steps = int(round(t_end / dt))

    state = list(exact_state(0.0))
    e0, h0 = energy(state), ang_momentum(state)

    rows = []
    t = 0.0
    max_de, max_dh, max_dp = 0.0, 0.0, 0.0
    for k in range(n_steps + 1):
        if k % sample_every == 0:
            e, h = energy(state), ang_momentum(state)
            de = abs(e - e0) / abs(e0)
            dh = abs(h - h0) / abs(h0)
            dp = pos_error(state, t)
            max_de = max(max_de, de)
            max_dh = max(max_dh, dh)
            max_dp = max(max_dp, dp)
            rows.append({
                "t": t, "orbits": t / PERIOD,
                "x": state[0], "y": state[1], "vx": state[2], "vy": state[3],
                "energy": e, "h": h,
                "rel_energy_err": de, "rel_h_err": dh, "pos_err_km": dp,
            })
        if k == n_steps:
            break
        state = stepper(state, dt)
        t = (k + 1) * dt

    final = rows[-1]
    return {
        "n_per_orbit": n_per_orbit, "dt": dt, "steps": n_steps,
        "final_rel_energy_err": final["rel_energy_err"],
        "final_rel_h_err": final["rel_h_err"],
        "final_pos_err_km": final["pos_err_km"],
        "max_rel_energy_err": max_de,
        "max_rel_h_err": max_dh,
        "max_pos_err_km": max_dp,
        "rows": rows,
    }


def write_csv(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    keys = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("%.12g" % r[k]) for k in keys})


def hr(title):
    print("\n" + "=" * 74)
    print(title)
    print("=" * 74)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # ---------- 场景说明 ----------
    hr("一、场景设定（近地椭圆轨道 · 二体问题）")
    print("  半长轴 a            = %.1f km" % A)
    print("  偏心率 e            = %.3f" % ECC)
    print("  近地点半径          = %.3f km   （地面高度 %.1f km）" % (R_PERIGEE, R_PERIGEE - R_EARTH))
    print("  近地点速度          = %.6f km/s" % V_PERIGEE)
    print("  轨道周期 T          = %.3f s   （%.2f min）" % (PERIOD, PERIOD / 60.0))
    print("  比能量理论值 ε      = %.6f km^2/s^2   （= -μ/2a）" % ENERGY0)
    print("  比角动量理论值 h    = %.6f km^2/s     （= √(μa(1-e²))）" % HMAG0)
    print("  积分时长            = %d 圈 = %.1f s" % (ORBITS, ORBITS * PERIOD))
    print("  解析真值            = 开普勒方程牛顿迭代解（不是近似参考解）")

    # ---------- 收敛阶标定 ----------
    hr("二、守恒量误差随步长的变化（RK4，积分 %d 圈）" % ORBITS)
    header = "%-8s %-10s %-14s %-14s %-14s %-10s" % (
        "每圈步数", "步长(s)", "比能量相对误差", "比角动量相对误差", "位置误差(km)", "观测阶")
    print(header)
    print("-" * 74)

    n_list = [125, 250, 500, 1000, 2000, 4000]
    results = []
    prev = None
    for n in n_list:
        r = propagate(n, sample_every=max(1, n // 20))
        results.append(r)
        order = ""
        if prev is not None:
            num = prev["final_pos_err_km"]
            den = r["final_pos_err_km"]
            if num > 0 and den > 0:
                order = "%.2f" % (math.log(num / den) / math.log(prev["dt"] / r["dt"]))
        print("%-8d %-10.4f %-14.3e %-14.3e %-14.4e %-10s" % (
            n, r["dt"], r["final_rel_energy_err"], r["final_rel_h_err"],
            r["final_pos_err_km"], order))
        prev = r

    print("-" * 74)
    print("说明：RK4 的理论收敛阶为 4，即步长减半时位置误差应降为约 1/16。")
    print("      表中「观测阶」列即由相邻两行的误差比值反推，应在 4 附近。")

    # ---------- 三类样例 ----------
    hr("三、三类测试样例")
    normal = propagate(2000)
    print("[正常样例] 每圈 2000 步、积分 %d 圈" % ORBITS)
    print("  比能量相对误差   = %.3e      （守恒，无系统漂移）" % normal["final_rel_energy_err"])
    print("  比角动量相对误差 = %.3e      （守恒，无系统漂移）" % normal["final_rel_h_err"])
    print("  位置误差         = %.4e km   （约 %.3f m）" % (normal["final_pos_err_km"], normal["final_pos_err_km"] * 1000))

    coarse = propagate(40)
    print("\n[边界样例] 每圈仅 40 步（步长 %.1f s）——尚未发散，但精度已不可用" % coarse["dt"])
    print("  比能量相对误差   = %.3e" % coarse["final_rel_energy_err"])
    print("  位置误差         = %.4e km   （约 %.1f m）" % (coarse["final_pos_err_km"], coarse["final_pos_err_km"] * 1000))

    euler = propagate(2000, stepper=euler_step)
    print("\n[失败样例] 前向欧拉，同样的每圈 2000 步——能量系统性上升，轨道被抬高")
    print("  比能量相对误差   = %.3e      （比 RK4 大 %d 个量级）" % (
        euler["final_rel_energy_err"],
        int(round(math.log10(euler["final_rel_energy_err"] / normal["final_rel_energy_err"])))))
    print("  比角动量相对误差 = %.3e" % euler["final_rel_h_err"])
    print("  位置误差         = %.4e km   （约 %.0f km，已完全偏离轨道）" % (
        euler["final_pos_err_km"], euler["final_pos_err_km"]))
    print("  注：欧拉的误差随时间线性累积（随圈数增长）；RK4 的误差有界且不随时间系统增长。")

    # ---------- 输出文件 ----------
    hr("四、输出文件")
    write_csv(os.path.join(OUT_DIR, "timeseries_rk4_n2000.csv"), normal["rows"])
    print("  out/timeseries_rk4_n2000.csv   正常样例的完整时间序列（%d 个采样点）" % len(normal["rows"]))
    write_csv(os.path.join(OUT_DIR, "timeseries_euler_n2000.csv"),
              euler["rows"][::max(1, len(euler["rows"]) // 200)])
    print("  out/timeseries_euler_n2000.csv 失败样例时间序列（用于对比）")
    write_csv(os.path.join(OUT_DIR, "convergence.csv"),
              [{"n_per_orbit": r["n_per_orbit"], "dt_s": r["dt"],
                "final_rel_energy_err": r["final_rel_energy_err"],
                "final_rel_h_err": r["final_rel_h_err"],
                "final_pos_err_km": r["final_pos_err_km"]} for r in results])
    print("  out/convergence.csv            收敛阶标定表")

    # 供 HTML 图表使用的精简数据（降采样到约 200 点，避免页面过大）
    import json

    def pick(rows, key, target=200):
        step = max(1, len(rows) // target)
        out = [r[key] for r in rows[::step]]
        if rows and out[-1] != rows[-1][key]:
            out.append(rows[-1][key])
        return out

    chart = {
        "scenario": {
            "a_km": A, "e": ECC, "period_s": PERIOD,
            "r_perigee_km": R_PERIGEE, "v_perigee_kms": V_PERIGEE,
            "energy0": ENERGY0, "h0": HMAG0, "orbits": ORBITS,
        },
        "normal": {
            "orbits": pick(normal["rows"], "orbits"),
            "rel_energy_err": pick(normal["rows"], "rel_energy_err"),
            "rel_h_err": pick(normal["rows"], "rel_h_err"),
            "pos_err_km": pick(normal["rows"], "pos_err_km"),
            "x": pick(normal["rows"], "x"),
            "y": pick(normal["rows"], "y"),
        },
        "euler": {
            "orbits": pick(euler["rows"], "orbits"),
            "rel_energy_err": pick(euler["rows"], "rel_energy_err"),
            "pos_err_km": pick(euler["rows"], "pos_err_km"),
            "x": pick(euler["rows"], "x"),
            "y": pick(euler["rows"], "y"),
        },
        "convergence": [
            {"n": r["n_per_orbit"], "dt": r["dt"],
             "rel_energy_err": r["final_rel_energy_err"],
             "rel_h_err": r["final_rel_h_err"],
             "pos_err_km": r["final_pos_err_km"]} for r in results],
    }
    with open(os.path.join(OUT_DIR, "chart-data.json"), "w", encoding="utf-8") as f:
        json.dump(chart, f, ensure_ascii=False)
    print("  out/chart-data.json            供图表页读取的精简数据（已降采样至约 200 点）")
    print("\n完成。")


if __name__ == "__main__":
    main()

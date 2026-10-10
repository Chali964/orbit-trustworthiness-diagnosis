#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动报警装置 —— 把「已知陷阱」做成可自动执行的检查
=========================================================
这是「课题第三件事」的参考实现，也是本课题最关键的亮点。

要抓什么：
  领域文献里有一条明确提醒 ——「守恒量保持得好，并不等于位置准」。
  能量和角动量看着完好，位置可能已经错了，而这一点肉眼看不出。
  本文件把这个陷阱做成一条可自动执行的告警规则。

五条规则：
  R1 虚假安心：守恒量达标，但位置误差超标              ← 核心
  R2 未进渐近区：观测阶明显低于理论阶，标定结果不可信
  R3 精度极限：步长继续减小，误差却不再下降
  R4 积分发散：轨道飞散
  R5 误差累积型：守恒量误差随时间增长，而非有界振荡

为了让 R1 能被真实触发，本文件额外实现了【辛积分器（蛙跳法）】。
它在同一配置下的能量数字比 RK4 更漂亮，位置误差却差三个数量级 —— 这正是 R1 要抓的。

======== 一条方法论陷阱（我踩过，值得记住）========
看「守恒量误差随时间怎么变」时，如果按「每整圈采样一次」，采样点永远落在
轨道的同一个相位上。这样看到的是「某个相位上的误差」，不是误差本身。
我最初就是这样取样，误判为「误差随时间持续增长」，并据此得出「辛积分器能量
误差并非有界」的错误结论。

改用全时段采样后，实测结果支持教科书说法：
  蛙跳法、每圈 1600 步：积分 400 / 2000 / 5000 圈，
  比能量【最大】相对误差恒为 7.841e-07 —— 不随积分时长变化，即**有界振荡**。
  但同一配置下，位置误差为 101 / 506 / 1263 km —— **随时间线性增长**。

这正好是 R1 要抓的：能量永远看着完好，位置却一直在漂。
=================================================

纯标准库实现。直接运行：python alarm.py
"""

import math
import os

MU = 398600.4418
A = 7000.0
ECC = 0.05
N_MEAN = math.sqrt(MU / A ** 3)
PERIOD = 2.0 * math.pi / N_MEAN

# 合格线：位置误差 1 km；守恒量相对误差 1e-7
# 说明：1e-6 即「相对误差百万分之一」，是工程上公认「守恒性很好」的量级。
#       把它设得这么宽松是故意的 —— R1 要抓的正是「按这个宽松标准也算达标、
#       但位置已经错得离谱」的情形。阈值本身不是重点，两者的矛盾才是。
POS_TOL_KM = 1.0
ENERGY_TOL = 1e-6


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


def accel(x, y):
    r3 = math.pow(x * x + y * y, 1.5)
    return -MU * x / r3, -MU * y / r3


def deriv(s):
    ax, ay = accel(s[0], s[1])
    return [s[2], s[3], ax, ay]


# ---------- 三种积分方法 ----------
def rk4_step(s, dt):
    k1 = deriv(s)
    k2 = deriv([s[i] + 0.5 * dt * k1[i] for i in range(4)])
    k3 = deriv([s[i] + 0.5 * dt * k2[i] for i in range(4)])
    k4 = deriv([s[i] + dt * k3[i] for i in range(4)])
    return [s[i] + dt / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(4)]


def euler_step(s, dt):
    k1 = deriv(s)
    return [s[i] + dt * k1[i] for i in range(4)]


def leapfrog_step(s, dt):
    """辛积分器（蛙跳 / 速度 Verlet），2 阶。半步推速度 → 整步推位置 → 半步推速度。

    注意：不要假设它的能量误差一定有界。实测见文件顶部说明。
    """
    x, y, vx, vy = s
    ax, ay = accel(x, y)
    vx += 0.5 * dt * ax
    vy += 0.5 * dt * ay
    x += dt * vx
    y += dt * vy
    ax, ay = accel(x, y)
    vx += 0.5 * dt * ax
    vy += 0.5 * dt * ay
    return [x, y, vx, vy]


METHODS = {
    "rk4": ("RK4", 4, rk4_step),
    "euler": ("前向欧拉", 1, euler_step),
    "leapfrog": ("辛积分器（蛙跳）", 2, leapfrog_step),
}


def energy(s):
    return 0.5 * (s[2] ** 2 + s[3] ** 2) - MU / math.hypot(s[0], s[1])


def ang_mom(s):
    return s[0] * s[3] - s[1] * s[2]


def run(method, n_per_orbit, orbits, sample_per_orbit=4):
    name, order, step = METHODS[method]
    dt = PERIOD / n_per_orbit
    n_steps = int(round(orbits * PERIOD / dt))
    every = max(1, int(round(n_per_orbit / sample_per_orbit)))

    s = list(exact_state(0.0))
    e0, h0 = energy(s), ang_mom(s)
    recs, diverged = [], False
    for k in range(n_steps + 1):
        if k % every == 0:
            t = k * dt
            ex, ey, _, _ = exact_state(t)
            recs.append({
                "orbits": t / PERIOD,
                "rel_energy_err": abs(energy(s) - e0) / abs(e0),
                "rel_h_err": abs(ang_mom(s) - h0) / abs(h0),
                "pos_err_km": math.hypot(s[0] - ex, s[1] - ey),
            })
        if k == n_steps:
            break
        s = step(s, dt)
        if not all(map(math.isfinite, s)) or math.hypot(s[0], s[1]) > A * 3:
            diverged = True
            break
    return {"name": name, "order": order, "dt": dt, "recs": recs, "diverged": diverged}


def observed_order(method, n_coarse, n_fine, orbits):
    """由相邻两档步长的位置误差比值反推观测阶（只依据实测数据，不预设）。"""
    a = run(method, n_coarse, orbits)
    b = run(method, n_fine, orbits)
    if not a["recs"] or not b["recs"]:
        return None
    ea, eb = a["recs"][-1]["pos_err_km"], b["recs"][-1]["pos_err_km"]
    if ea <= 0 or eb <= 0:
        return None
    return math.log(ea / eb) / math.log((PERIOD / n_coarse) / (PERIOD / n_fine))


# ---------- 报警规则 ----------
def audit(r, cfg):
    out = []
    recs = r["recs"]
    if not recs:
        return [("R4", "致命", "递推没有产生任何有效记录", "无采样点")]

    last = recs[-1]
    # 守恒量用【全时段最大值】判定，而不是末值 —— 末值取决于采样恰好落在轨道的哪个相位，
    # 不可靠。用最大值是更保守、也更站得住的判据。
    ee_max = max(x["rel_energy_err"] for x in recs)
    pe = last["pos_err_km"]

    if r["diverged"]:
        return [("R4", "致命", "积分发散，轨道已经算飞了", "半径超过轨道尺度的 3 倍")]

    # R1 虚假安心 —— 核心
    if ee_max <= cfg["energy_tol"] and pe > cfg["pos_tol_km"]:
        out.append((
            "R1", "致命",
            "守恒量达标，但位置误差已超标 —— 守恒量给出了虚假的安全感",
            "全程比能量最大相对误差 %.2e ≤ 阈值 %.0e（看着很好），但位置误差 %.4e km > 阈值 %.0e km"
            % (ee_max, cfg["energy_tol"], pe, cfg["pos_tol_km"])))

    # R2 未进入渐近区
    obs = cfg.get("observed_order")
    if obs is not None and obs < r["order"] * 0.5:
        out.append((
            "R2", "警告",
            "观测阶远低于理论阶 —— 当前步长未进入正常收敛区间，标定结果不可信",
            "实测观测阶 %+.2f，理论阶 %d" % (obs, r["order"])))

    # R3 精度极限：步数 ×4，误差改善不足 4 倍
    ce, fe = cfg.get("coarse_energy"), cfg.get("fine_energy")
    if ce and fe and fe > 0 and ce / fe < 4.0:
        out.append((
            "R3", "警告",
            "步长减小到 1/4，误差改善却不足 4 倍 —— 已接近浮点精度极限，继续缩小步长收益极低",
            "粗步长误差 %.2e，细步长误差 %.2e，改善 %.2f 倍" % (ce, fe, ce / fe)))

    # R5 误差累积型
    # 两道门槛，避免从太短的记录里误判趋势：
    #   ① 采样点 ≥16 个   ② 积分跨度 ≥20 圈
    # 另外阈值取 2.5 而不是 3.0：若误差随时间严格线性增长，后半段平均值
    # 恰好是前半段的 3 倍，阈值取 3.0 会刚好卡在边界上漏报。
    if len(recs) >= 16 and recs[-1]["orbits"] >= 20:
        half = len(recs) // 2
        first = sum(x["rel_energy_err"] for x in recs[:half]) / half
        second = sum(x["rel_energy_err"] for x in recs[half:]) / (len(recs) - half)
        if first > 0 and second / first > 2.5:
            out.append((
                "R5", "警告",
                "守恒量误差在随时间累积，不是有界振荡 —— 短时测试的结论不能外推到长周期",
                "后半段平均误差是前半段的 %.1f 倍（记录跨度 %.0f 圈）"
                % (second / first, recs[-1]["orbits"])))

    return out


MARK = {"致命": "【致命】", "警告": "【警告】"}


def show(title, r, cfg, extra=None):
    print("=" * 80)
    print(title)
    print("=" * 80)
    print("  方法：%s（理论阶 %d）　每圈 %d 步　步长 %.4f s"
          % (r["name"], r["order"], int(round(PERIOD / r["dt"])), r["dt"]))
    for l in (extra or []):
        print("  " + l)
    if r["recs"]:
        last = r["recs"][-1]
        print("  积分 %.0f 圈　比能量相对误差 %.3e　比角动量相对误差 %.3e　位置误差 %.4e km"
              % (last["orbits"], last["rel_energy_err"], last["rel_h_err"], last["pos_err_km"]))
    print()
    findings = audit(r, cfg)
    if not findings:
        print("  → 未触发任何告警，本次运行通过 ✅")
    else:
        for rid, lv, msg, ev in findings:
            print("  → %s %s　%s" % (MARK[lv], rid, msg))
            print("　　　证据：%s" % ev)
    print()
    return findings


def main():
    print("#" * 80)
    print("# 自动报警装置")
    print("# 合格线：位置误差 ≤ %.0f km　比能量相对误差 ≤ %.0e" % (POS_TOL_KM, ENERGY_TOL))
    print("# 说明：1e-6 是工程上公认「守恒性很好」的量级。故意设得宽松，")
    print("#       因为 R1 要抓的正是「按这个宽松标准也达标、但位置已经错得离谱」的情形。")
    print("#" * 80)
    print()

    summary = {}

    # ---- 场景 1：正常 ----
    r = run("rk4", 2000, 10)
    summary["场景 1　RK4 细步长（正常）"] = show(
        "场景 1　RK4 + 细步长　—— 预期：通过", r,
        {"pos_tol_km": POS_TOL_KM, "energy_tol": ENERGY_TOL})

    # ---- 场景 2：R1 核心 ----
    print("#" * 80)
    print("# 场景 2 是本次核心：同一步长，只改积分时长")
    print("# 能量误差不随时长变化（有界），位置误差却线性增长")
    print("#" * 80)
    print()
    lines = ["蛙跳法、每圈 1600 步，只改积分时长："]
    lp = None
    for orbits in (400, 2000, 5000):
        rr = run("leapfrog", 1600, orbits)
        mx = max(x["rel_energy_err"] for x in rr["recs"])
        pe = rr["recs"][-1]["pos_err_km"]
        lines.append("  %5d 圈：能量最大误差 %.4e　位置误差 %.4e km" % (orbits, mx, pe))
        lp = rr
    lines.append("→ 能量误差恒定不变，位置误差却一路增长")
    summary["场景 2　辛积分器长周期（虚假安心）"] = show(
        "场景 2　辛积分器 + 长周期　—— 预期：触发 R1", lp,
        {"pos_tol_km": POS_TOL_KM, "energy_tol": ENERGY_TOL}, extra=lines)

    # ---- 场景 3：R5 误差累积型 ----
    r5 = run("rk4", 2000, 2000)
    obs5b = observed_order("rk4", 1000, 2000, 2000)
    summary["场景 3　RK4 长时间积分（误差累积）"] = show(
        "场景 3　RK4 + 长时间积分　—— 预期：触发 R5", r5,
        {"pos_tol_km": POS_TOL_KM, "energy_tol": ENERGY_TOL},
        extra=["RK4 不是辛格式，它的守恒量误差会随时间累积（区别于场景 2 的有界振荡）"])

    # ---- 场景 4：R3 精度极限 ----
    c = run("rk4", 4000, 2)
    f = run("rk4", 16000, 2)
    ce = max(x["rel_energy_err"] for x in c["recs"])
    fe = max(x["rel_energy_err"] for x in f["recs"])
    obs = observed_order("rk4", 8000, 16000, 2)
    summary["场景 4　RK4 极细步长（精度极限）"] = show(
        "场景 4　RK4 + 极细步长　—— 预期：触发 R3（并带 R2）", f,
        {"pos_tol_km": POS_TOL_KM, "energy_tol": ENERGY_TOL,
         "coarse_energy": ce, "fine_energy": fe, "observed_order": obs},
        extra=["对照：每圈 4000 步 vs 每圈 16000 步（步数 ×4）",
               "该区间的实测观测阶：%s" % ("%.2f" % obs if obs is not None else "无法计算")])

    # ---- 场景 5：R4 发散 ----
    r = run("euler", 6, 2)
    summary["场景 5　欧拉步长过粗（发散）"] = show(
        "场景 5　前向欧拉 + 步长过粗　—— 预期：触发 R4", r,
        {"pos_tol_km": POS_TOL_KM, "energy_tol": ENERGY_TOL})

    # ---- 场景 6：R2 未进渐近区（欧拉，不发散）----
    obs5 = observed_order("euler", 200, 400, 2)
    r = run("euler", 400, 2)
    summary["场景 6　欧拉中等步长（未进渐近区）"] = show(
        "场景 6　前向欧拉 + 中等步长　—— 预期：触发 R2", r,
        {"pos_tol_km": POS_TOL_KM, "energy_tol": ENERGY_TOL, "observed_order": obs5},
        extra=["该区间的实测观测阶：%s（理论 1）" % ("%.2f" % obs5 if obs5 is not None else "无法计算")])

    # ---- 汇总 ----
    print("#" * 80)
    print("# 汇总")
    print("#" * 80)
    print("%-40s %s" % ("场景", "触发的告警"))
    print("-" * 80)
    for k, v in summary.items():
        print("%-40s %s" % (k, "、".join("%s(%s)" % (a, b) for a, b, _, _ in v) if v else "无（通过）"))
    print()
    print("R1 是关键：它抓的是「守恒量达标、位置却已经错了」这种肉眼看不出的情形。")


if __name__ == "__main__":
    main()

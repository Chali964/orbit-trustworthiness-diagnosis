#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""探测：找出各条报警规则真正能被触发的参数区间（先测量，再设计场景）"""
import math, sys, os, importlib.util

spec = importlib.util.spec_from_file_location(
    "alm", os.path.join(os.path.dirname(os.path.abspath(__file__)), "alarm.py"))
alm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(alm)

def probe(method, n, orbits):
    r = alm.run(method, n, orbits)
    if not r["recs"]:
        return None
    last = r["recs"][-1]
    return {"div": r["diverged"], "ee": last["rel_energy_err"],
            "pe": last["pos_err_km"], "orbits": last["orbits"]}

print("=" * 84)
print("探测 1：辛积分器（蛙跳）—— 寻找「能量达标但位置超差」的组合")
print("=" * 84)
print("%-8s %-8s %-14s %-16s %-8s" % ("每圈步数", "圈数", "比能量相对误差", "位置误差(km)", "R1?"))
for n in [200, 400, 800]:
    for orbits in [50, 100, 200, 400]:
        p = probe("leapfrog", n, orbits)
        if p is None: continue
        r1 = (not p["div"]) and p["ee"] <= 1e-7 and p["pe"] > 1.0
        print("%-8d %-8d %-14.3e %-16.4e %-8s" % (n, orbits, p["ee"], p["pe"], "★触发" if r1 else ""))

print()
print("=" * 84)
print("探测 2：RK4 极细步长 —— 误差在什么步长停止下降（浮点舍入极限）")
print("=" * 84)
prev = None
print("%-10s %-14s %-14s %-14s" % ("每圈步数", "比能量相对误差", "相邻改善倍数", "位置误差(km)"))
for n in [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000]:
    p = probe("rk4", n, 2)
    if p is None: continue
    ratio = (prev["ee"] / p["ee"]) if (prev and p["ee"] > 0) else float("nan")
    print("%-10d %-14.3e %-14s %-14.3e" % (n, p["ee"], ("%.2f" % ratio) if ratio == ratio else "-", p["pe"]))
    prev = p

print()
print("=" * 84)
print("探测 3：观测阶在粗步长与极细步长两端会怎么变化")
print("=" * 84)
def obs_order(method, n1, n2, orbits=2):
    a = probe(method, n1, orbits); b = probe(method, n2, orbits)
    if not a or not b or a["pe"] <= 0 or b["pe"] <= 0: return None
    dt1, dt2 = alm.PERIOD / n1, alm.PERIOD / n2
    return math.log(a["pe"] / b["pe"]) / math.log(dt1 / dt2)

print("（用位置误差反推，因为位置误差才是我们关心的精度指标）")
for method in ["rk4", "leapfrog", "euler"]:
    theory = {"rk4":4, "leapfrog":2, "euler":1}[method]
    for (n1, n2) in [(50,100), (200,400), (1000,2000), (8000,16000), (32000,64000)]:
        o = obs_order(method, n1, n2)
        if o is None:
            print("  %-10s %6d→%-6d  数据缺失" % (method, n1, n2)); continue
        flag = "  ← 低于理论阶一半" if o < theory*0.5 else ""
        print("  %-10s %6d→%-6d  观测阶 %+.2f（理论 %d）%s" % (method, n1, n2, o, theory, flag))
    print()

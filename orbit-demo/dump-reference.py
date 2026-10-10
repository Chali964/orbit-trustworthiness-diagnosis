#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
导出 Python 参考实现的结果，供 JS 移植版对拍使用（V&V 第 2 级：代码间比对）。

只用标准库，输出 JSON：
    [{"method":..., "nPerOrbit":..., "orbits":..., "t0":...,
      "positionErrorKm":..., "relEnergyError":..., "relAngularMomentumError":...,
      "diverged":..., "steps":...}, ...]

运行：python dump-reference.py
"""

import json
import math
import os
import sys

MU = 398600.4418
A_SEMI = 7000.0
ECC = 0.05
N_MEAN = math.sqrt(MU / A_SEMI ** 3)
PERIOD = 2.0 * math.pi / N_MEAN
DIM_LIMIT = A_SEMI * 3


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
    b = A_SEMI * math.sqrt(1.0 - ECC ** 2)
    return [A_SEMI * (cE - ECC), b * sE, -A_SEMI * sE * Edot, b * cE * Edot]


def accel(x, y):
    r3 = math.pow(x * x + y * y, 1.5)
    return -MU * x / r3, -MU * y / r3


def deriv(s):
    ax, ay = accel(s[0], s[1])
    return [s[2], s[3], ax, ay]


def energy(s):
    return 0.5 * (s[2] ** 2 + s[3] ** 2) - MU / math.hypot(s[0], s[1])


def ang_mom(s):
    return s[0] * s[3] - s[1] * s[2]


# ---- 单步推进器（与 JS 版逐行对应）----
def st_euler(s, dt):
    k = deriv(s)
    return [s[i] + dt * k[i] for i in range(4)]


def st_heun(s, dt):
    k1 = deriv(s)
    p = [s[i] + dt * k1[i] for i in range(4)]
    k2 = deriv(p)
    return [s[i] + dt * 0.5 * (k1[i] + k2[i]) for i in range(4)]


def st_midpoint(s, dt):
    k1 = deriv(s)
    m = [s[i] + 0.5 * dt * k1[i] for i in range(4)]
    k2 = deriv(m)
    return [s[i] + dt * k2[i] for i in range(4)]


def st_rk4(s, dt):
    k1 = deriv(s)
    k2 = deriv([s[i] + 0.5 * dt * k1[i] for i in range(4)])
    k3 = deriv([s[i] + 0.5 * dt * k2[i] for i in range(4)])
    k4 = deriv([s[i] + dt * k3[i] for i in range(4)])
    return [s[i] + dt / 6.0 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) for i in range(4)]


def st_leapfrog(s, dt):
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
    "rk4": st_rk4,
    "heun": st_heun,
    "midpoint": st_midpoint,
    "leapfrog": st_leapfrog,
    "euler": st_euler,
}


def propagate(method, n_per_orbit, orbits, t0=0.0):
    step = METHODS[method]
    dt = PERIOD / n_per_orbit
    n_steps = max(1, int(round(orbits * n_per_orbit)))
    s = exact_state(t0)
    e0 = energy(s)
    h0 = ang_mom(s)
    diverged = False
    done = 0
    for k in range(n_steps):
        s = step(s, dt)
        done = k + 1
        r = math.hypot(s[0], s[1])
        if not math.isfinite(r) or r > DIM_LIMIT:
            diverged = True
            break
    ex = exact_state(t0 + done * dt)
    return {
        "method": method,
        "nPerOrbit": n_per_orbit,
        "orbits": orbits,
        "t0": t0,
        "dtSeconds": dt,
        "steps": done,
        "positionErrorKm": math.hypot(s[0] - ex[0], s[1] - ex[1]),
        "relEnergyError": abs(energy(s) - e0) / abs(e0),
        "relAngularMomentumError": abs(ang_mom(s) - h0) / abs(h0),
        "diverged": diverged,
    }


CASES = [
    ("rk4", 50, 2, 0.0),
    ("rk4", 100, 2, 0.0),
    ("rk4", 400, 2, 0.0),
    ("rk4", 1600, 2, 0.0),
    ("rk4", 400, 2, PERIOD / 3.0),
    ("heun", 400, 2, 0.0),
    ("midpoint", 400, 2, 0.0),
    ("leapfrog", 400, 2, 0.0),
    ("leapfrog", 1600, 2, 0.0),
    ("euler", 400, 2, 0.0),
    ("euler", 1183, 2, 0.0),
]


def main():
    out = []
    for method, n, orb, t0 in CASES:
        out.append(propagate(method, n, orb, t0))
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "reference-js-crosscheck.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("已写出 %d 条参考记录：" % len(out), path)
    if len(sys.argv) > 1 and sys.argv[1] == "-v":
        for r in out:
            print("  %-9s n=%-7d orb=%s t0=%-9.3f pos=%.6e relE=%.6e" %
                  (r["method"], r["nPerOrbit"], r["orbits"], r["t0"],
                   r["positionErrorKm"], r["relEnergyError"]))


if __name__ == "__main__":
    main()

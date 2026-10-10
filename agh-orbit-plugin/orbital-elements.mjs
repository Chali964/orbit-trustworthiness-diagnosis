/**
 * 轨道要素 ⇄ 位置速度 转换
 * =============================
 * 本模块是为了**与外部权威基准对拍**而写的。
 *
 * 我们的数值内核（index.mjs）只接受「半长轴 + 偏心率」，内部直接以位置速度为状态量。
 * 而 Orekit、Curtis 教材等外部基准都是以**经典轨道要素**（a, e, i, Ω, ω, M）给出输入输出的。
 * 所以需要一个转换层。
 *
 * ★ 这个转换本身也是被验证的对象。实现依据：
 *   Vallado, "Fundamentals of Astrodynamics and Applications"（算法 10 / 11）
 *   Curtis, "Orbital Mechanics for Engineering Students"（算法 4.1 / 4.2）
 *
 * 单位约定：长度 km、时间 s（与内核一致）
 *
 * ⚠️ 角度一律用**弧度**。从教材抄度数时记得转换。
 */

// ── 向量小工具 ─────────────────────────────────────────────
export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vmul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const vnorm = (a) => Math.sqrt(vdot(a, a));

// ── 开普勒方程：由平近点角 M 求偏近点角 E ──────────────────
/**
 * 牛顿迭代。椭圆情形（0 ≤ e < 1）。
 * 初值用 E0 = M + e·sin(M)（Danby 建议），椭圆范围内收敛很快。
 */
export function solveKepler(M, e, tol = 1e-14, maxIter = 100) {
  // 先把 M 归一化到 [-π, π]
  let m = M % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  if (m < -Math.PI) m += 2 * Math.PI;

  let E = m + e * Math.sin(m);
  for (let k = 0; k < maxIter; k++) {
    const f = E - e * Math.sin(E) - m;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < tol) break;
  }
  return E;
}

/**
 * 经典轨道要素 → 位置速度（惯性系）。
 *
 * @param {object} el
 *   a    半长轴（km）
 *   e    偏心率
 *   i    倾角（rad）
 *   raan 升交点赤经 Ω（rad）
 *   argp 近地点幅角 ω（rad）
 *   M    平近点角（rad）—— 注意是 **MEAN** anomaly
 *   mu   引力常数（km³/s²）
 * @returns {{r:number[], v:number[], rmag:number, vmag:number}}
 */
export function elementsToState({ a, e, i, raan, argp, M, mu }) {
  const E = solveKepler(M, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  const oneMinusECosE = 1 - e * cosE;
  const rmag = a * oneMinusECosE;
  const sqrtOneMinusE2 = Math.sqrt(1 - e * e);

  // 近焦点（perifocal）坐标系下的位置与速度
  const xpf = a * (cosE - e);
  const ypf = a * sqrtOneMinusE2 * sinE;
  const sqrtMuA = Math.sqrt(mu * a);
  const vxpf = -sqrtMuA * sinE / rmag;
  const vypf = sqrtMuA * sqrtOneMinusE2 * cosE / rmag;
  const vmag = Math.sqrt(vxpf * vxpf + vypf * vypf);

  // 旋转：近焦点系 → 惯性系（绕 ω → i → Ω）
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(i), si = Math.sin(i);
  const cO = Math.cos(raan), sO = Math.sin(raan);

  // 方向余弦矩阵的行（Vallado Eq. 2-113 展开）
  const R = [
    [cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si],
    [sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si],
    [sw * si, cw * si, ci],
  ];

  const rot = (x, y) => [
    R[0][0] * x + R[0][1] * y,
    R[1][0] * x + R[1][1] * y,
    R[2][0] * x + R[2][1] * y,
  ];

  return { r: rot(xpf, ypf), v: rot(vxpf, vypf), rmag, vmag };
}

/**
 * 位置速度 → 经典轨道要素（惯性系）。
 * 用于反向自检（要素 → 状态 → 要素 应闭合）。
 */
export function stateToElements(r, v, mu) {
  const rmag = vnorm(r);
  const vmag = vnorm(v);
  const h = vcross(r, v);
  const hmag = vnorm(h);

  // 节线向量
  const K = [0, 0, 1];
  const n = vcross(K, h);
  const nmag = vnorm(n);

  // 偏心率向量
  const rdotv = vdot(r, v);
  const evec = vmul(vsub(vmul(r, vmag * vmag - mu / rmag), vmul(v, rdotv)), 1 / mu);
  const e = vnorm(evec);

  // 能量与半长轴
  const energy = vmag * vmag / 2 - mu / rmag;
  const a = e === 1 ? Infinity : -mu / (2 * energy);

  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hmag)));
  let raan = Math.acos(Math.max(-1, Math.min(1, n[0] / nmag)));
  if (n[1] < 0) raan = 2 * Math.PI - raan;

  let argp = Math.acos(Math.max(-1, Math.min(1, vdot(n, evec) / (nmag * e))));
  if (evec[2] < 0) argp = 2 * Math.PI - argp;

  let nu = Math.acos(Math.max(-1, Math.min(1, vdot(evec, r) / (e * rmag))));
  if (rdotv < 0) nu = 2 * Math.PI - nu;

  // 真近点角 → 平近点角
  const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
  const M = E - e * Math.sin(E);

  return { a, e, i, raan, argp, M, nu, E, hmag, energy, rmag, vmag };
}

/** 弧度 → 度 */
export const deg = (rad) => rad * 180 / Math.PI;
/** 度 → 弧度 */
export const rad = (d) => d * Math.PI / 180;

/** 向量差的模（用于对拍时算偏差） */
export const vdiff = (a, b) => vnorm(vsub(a, b));

/**
 * 二项比例的精确置信区间（Clopper-Pearson）
 * ==========================================
 *
 * 为什么要这个：我们的核心主张是"决定能否交付的那条判据零误报零漏报"。
 * 但统计学上，**0/181 不等于"真的零"**——只能说"在 181 次观测里没出现"。
 * 正确做法是给出**置信上界**：样本量越大，上界越紧。
 *
 * Clopper-Pearson 是基于二项分布的精确定义反解出来的区间，属于**保守方法**
 * （不会低估风险），所以适合用来支撑"零误报"这类断言。
 *
 * 实现依据：Numerical Recipes 的 betacf / betai（连分式 + Lanczos 求 lgamma）。
 */

// ── Lanczos 近似的 log Γ(x) ──────────────────────────────────────
const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.9843695780195716e-6, 1.5056327351493116e-7,
];

function lgamma(x) {
  if (x < 0.5) {
    // 反射公式
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ── 连分式（Numerical Recipes, betacf）──────────────────────────
function betacf(a, b, x) {
  const MAXIT = 300, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// ── 正则化不完全 Beta 函数 I_x(a,b)（Numerical Recipes, betai）──
export function betai(a, b, x) {
  if (!(x >= 0 && x <= 1)) throw new Error('betai: x 必须落在 [0,1]');
  if (x === 0) return 0;
  if (x === 1) return 1;
  const bt = Math.exp(
    lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** 二分法求 I_x(a,b) = target 的根 */
function solveBeta(a, b, target) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (betai(a, b, mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Clopper-Pearson 双侧置信区间。
 * @param {number} k  观测到的"成功"次数（如误报次数）
 * @param {number} n  试验总次数（如真阴性 + 假阳性）
 * @param {number} alpha  显著性水平（0.05 → 95% 置信）
 */
export function cpInterval(k, n, alpha = 0.05) {
  if (n <= 0) return { lo: 0, hi: 1, note: 'n=0，无法给区间' };
  k = Math.max(0, Math.min(n, k));
  // 注意：双侧区间的两端各取 α/2，所以闭式里必须用 alpha/2 而不是 alpha
  if (k === 0) return { lo: 0, hi: 1 - Math.pow(alpha / 2, 1 / n) };
  if (k === n) return { lo: Math.pow(alpha / 2, 1 / n), hi: 1 };
  return {
    lo: solveBeta(k, n - k + 1, alpha / 2),        // 下界：I_x(k, n-k+1) = α/2
    hi: solveBeta(k + 1, n - k, 1 - alpha / 2),    // 上界：I_x(k+1, n-k) = 1-α/2
  };
}

/** 单侧置信上界（我们主要用这个：想说"至多这么高"） */
export function cpUpper(k, n, alpha = 0.05) {
  if (n <= 0) return 1;
  k = Math.max(0, Math.min(n, k));
  if (k === n) return 1;
  if (k === 0) return 1 - Math.pow(alpha, 1 / n);   // 闭式
  return solveBeta(k + 1, n - k, 1 - alpha);        // I_x(k+1, n-k) = 1-α
}

/** 单侧置信下界 */
export function cpLower(k, n, alpha = 0.05) {
  if (n <= 0) return 0;
  k = Math.max(0, Math.min(n, k));
  if (k === 0) return 0;
  if (k === n) return Math.pow(alpha, 1 / n);
  return solveBeta(k, n - k + 1, alpha);
}

/**
 * 一次性算出某个比率及其区间，直接可用在报告里。
 * @param {string} label 名称（如"误报率"）
 * @param {number} k     分子（误报数 / 漏报数）
 * @param {number} n     分母（真阴性+假阳性 / 真阳性+假阴性）
 */
export function rateWithCI(label, k, n, alpha = 0.05) {
  const point = n > 0 ? k / n : NaN;
  return {
    label, k, n, alpha,
    point,
    upper: cpUpper(k, n, alpha),
    lower: cpLower(k, n, alpha),
    ci: cpInterval(k, n, alpha),
  };
}

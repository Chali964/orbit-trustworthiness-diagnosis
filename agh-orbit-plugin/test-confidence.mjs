/**
 * 置信区间模块的验收测试
 * ============================
 * 独立参照：`confidence-reference.json` 由 Python **scipy.stats.beta.ppf** 生成
 * （scipy 是与本模块完全独立的实现）。
 *
 * 运行：node test-confidence.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpInterval, cpUpper, cpLower, betai } from './confidence.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const chk = (cond, msg, detail = '') => {
  if (cond) { pass++; console.log('    ✓ ' + msg); }
  else { fail++; console.log('    ✗ ' + msg + (detail ? '  → ' + detail : '')); }
};

console.log('='.repeat(74));
console.log('置信区间模块验收（对照 scipy 参照值）');
console.log('='.repeat(74));

// ── 1. 与 scipy 逐组对拍 ─────────────────────────────────────────
const refPath = join(HERE, 'confidence-reference.json');
if (!existsSync(refPath)) {
  console.log('  [跳过] 找不到 confidence-reference.json');
  process.exit(1);
}
const refs = JSON.parse(readFileSync(refPath, 'utf-8'));

console.log('\n1) 与 scipy 对拍（11 组，容差 1e-9）');
const TOL = 1e-9;
let maxErr = 0, worst = '';
for (const r of refs) {
  const ci = cpInterval(r.k, r.n, 0.05);
  const up1 = cpUpper(r.k, r.n, 0.05);
  // 注意：参照文件里的 lo/hi 是【双侧】区间端点（各取 α/2），
  // 而 cpUpper/cpLower 是【单侧】端点（取 α）——只对 up1 与 r.up1 做比较。
  const e1 = Math.abs(ci.lo - r.lo), e2 = Math.abs(ci.hi - r.hi);
  const e3 = Math.abs(up1 - r.up1);
  const e = Math.max(e1, e2, e3);
  if (e > maxErr) { maxErr = e; worst = `k=${r.k},n=${r.n}`; }
  const label = `k=${String(r.k).padStart(3)}, n=${String(r.n).padStart(4)}`;
  if (e < TOL) {
    console.log(`    ✓ ${label}  lo=${ci.lo.toFixed(6)} hi=${ci.hi.toFixed(6)} 单侧上界=${up1.toFixed(6)}`);
    pass++;
  } else {
    console.log(`    ✗ ${label}  最大偏差 ${e.toExponential(2)}`);
    fail++;
  }
}
console.log(`    最大偏差 ${maxErr.toExponential(2)}（${worst}）`);

// ── 2. 闭式核对（k=0）───────────────────────────────────────────
console.log('\n2) k=0 时与闭式 1−α^(1/n) 核对');
for (const n of [20, 100, 181, 299, 375]) {
  const closed = 1 - Math.pow(0.05, 1 / n);
  const got = cpUpper(0, n, 0.05);
  chk(Math.abs(closed - got) < 1e-12,
    `n=${n}: 单侧上界 ${got.toFixed(6)}（闭式 ${closed.toFixed(6)}）`);
}

// ── 3. 经典公认值 ──────────────────────────────────────────────
console.log('\n3) 与经典公认值核对');
{
  const ci = cpInterval(0, 20, 0.05);
  chk(Math.abs(ci.hi - 0.168433) < 1e-5,
    `n=20,k=0 双侧上界 = ${ci.hi.toFixed(6)}（公认 0.168433）`);
}
{
  const ci = cpInterval(50, 100, 0.05);
  chk(Math.abs(ci.lo - 0.398321) < 1e-5 && Math.abs(ci.hi - 0.601679) < 1e-5,
    `n=100,k=50 → [${ci.lo.toFixed(6)}, ${ci.hi.toFixed(6)}]（公认 [0.398321, 0.601679]）`);
}
{
  const ci = cpInterval(1, 10, 0.05);
  chk(Math.abs(ci.lo - 0.002529) < 1e-5 && Math.abs(ci.hi - 0.445016) < 1e-5,
    `n=10,k=1 → [${ci.lo.toFixed(6)}, ${ci.hi.toFixed(6)}]（公认 [0.002529, 0.445016]）`);
}

// ── 4. 结构性质 ────────────────────────────────────────────────
console.log('\n4) 结构性质（不依赖外部参照，自查自洽）');
{
  // 对称性（单侧量之间）：lo(k,n) === 1 − upper(n−k,n)
  let ok = true, worstCase = '';
  for (const [k, n] of [[1, 20], [7, 100], [34, 480], [11, 45]]) {
    const a = cpLower(k, n, 0.05);
    const b = 1 - cpUpper(n - k, n, 0.05);
    if (Math.abs(a - b) > 1e-9) { ok = false; worstCase = `k=${k},n=${n}`; }
  }
  chk(ok, '对称性 lo(k,n) = 1 − upper(n−k,n)', worstCase);
}
{
  // 双侧区间的对称性：lo(k,n) = 1 − hi(n−k,n)
  let ok = true, worstCase = '';
  for (const [k, n] of [[1, 20], [7, 100], [34, 480], [11, 45]]) {
    const a = cpInterval(k, n, 0.05).lo;
    const b = 1 - cpInterval(n - k, n, 0.05).hi;
    if (Math.abs(a - b) > 1e-9) { ok = false; worstCase = `k=${k},n=${n}, 差 ${Math.abs(a - b).toExponential(2)}`; }
  }
  chk(ok, '双侧对称性 lo(k,n) = 1 − hi(n−k,n)', worstCase);
}
{
  // 单调性：n 增大时，k=0 的上界应严格变小
  let monotone = true;
  let prev = Infinity;
  for (const n of [10, 50, 181, 500, 2000]) {
    const u = cpUpper(0, n, 0.05);
    if (u >= prev) monotone = false;
    prev = u;
  }
  chk(monotone, 'k=0 时上界随 n 增大而单调收紧');
}
{
  // 区间必须包住点估计
  let ok = true;
  for (const [k, n] of [[0, 181], [1, 349], [7, 402], [11, 45], [50, 100]]) {
    const ci = cpInterval(k, n, 0.05);
    const p = k / n;
    if (!(ci.lo - 1e-12 <= p && p <= ci.hi + 1e-12)) ok = false;
  }
  chk(ok, '点估计落在区间内');
}
{
  // 显著性水平单调：α 越小，上界越宽
  const a = cpUpper(0, 181, 0.10);
  const b = cpUpper(0, 181, 0.05);
  const c = cpUpper(0, 181, 0.01);
  chk(a < b && b < c, `α 减小 → 上界放宽（0.10:${a.toFixed(4)} < 0.05:${b.toFixed(4)} < 0.01:${c.toFixed(4)}）`);
}
{
  // betai 基本性质：I_0.5(a,a) = 0.5
  const v = betai(3, 5, 0.5);
  const should = 0.5; // 对 a≠b 不是 0.5，用对称性 I_x(a,b)+I_{1-x}(b,a)=1 检查
  const sym = betai(3, 5, 0.3) + betai(5, 3, 0.7);
  chk(Math.abs(sym - 1) < 1e-10, `不完全 Beta 对称恒等式 I_x(a,b)+I_{1−x}(b,a)=1（实测 ${sym.toFixed(12)}）`);
}

// ── 5. 本次要写进报告的实际数字 ─────────────────────────────────
console.log('\n5) 本次报告要用的实际数字（95% 单侧上界）');
const REAL = [
  ['合格性判据 · 误报率', 0, 181],
  ['合格性判据 · 漏报率', 0, 299],
  ['R2 误报率', 1, 349],
  ['R2 漏报率', 3, 25],
  ['R3 误报率', 7, 402],
  ['R3 漏报率', 2, 18],
  ['R5 误报率', 0, 375],
  ['R5 漏报率', 11, 45],
];
for (const [label, k, n] of REAL) {
  const up = cpUpper(k, n, 0.05);
  const up99 = cpUpper(k, n, 0.01);
  console.log(`    ${label.padEnd(20)} ${k}/${n} = ${(k / n * 100).toFixed(1)}%` +
    `   95% 上界 ${(up * 100).toFixed(2)}%   99% 上界 ${(up99 * 100).toFixed(2)}%`);
}

console.log('\n' + '='.repeat(74));
console.log(`验收：通过 ${pass} 项，未通过 ${fail} 项`);
console.log('='.repeat(74));
process.exit(fail === 0 ? 0 : 1);

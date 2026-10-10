#!/usr/bin/env node
/**
 * orbit-plot —— 诊断图生成器（命令行）
 * =====================================
 * 供 Agnes 调用：把"参数写错了"这类情形画成对比图。
 *
 * 设计要点：
 *   · 零依赖，只用 Node 内置模块 —— 便于随仓库分发
 *   · 绘图函数从 index.mjs 复用（同一套代码，不会出现"文档与实现不一致"）
 *   · 输出 SVG 文件并打印路径，便于在界面上直接查看
 *
 * 用法：
 *   node orbit-plot.mjs mistake --a 700 --e 0.5
 *   node orbit-plot.mjs mistake --a 12000 --e 0.6
 *   node orbit-plot.mjs budget  --a 7000 --e 0.05 --steps 763
 *   node orbit-plot.mjs budget  --a 7000 --e 0.05 --steps 6125
 *   node orbit-plot.mjs profile  --a 7000 --e 0.05 --steps 763
 *   node orbit-plot.mjs compare  --a 7000 --e 0.05 --b 8000 --e 0.02
 */

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out', 'plots');

const EARTH_R = 6371;   // km，地球平均半径

// 绘图函数从 index.mjs 复用（同一套代码，不会出现"文档与实现不一致"）。
// 必须在任何使用之前声明 —— 用 const + 顶层 await，避免 TDZ。
let K = null;
try {
  K = await import('./index.mjs');
} catch (e) {
  console.error('[warn] 无法加载 index.mjs：' + (e && e.message ? e.message : e));
  console.error('[warn] 绘图功能将不可用。');
}

function need(name) {
  const f = K && K.__kernel && K.__kernel[name];
  if (!f) throw new Error(`绘图函数 ${name} 不可用（index.mjs 未加载）`);
  return f;
}

// ── 参数解析 ────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const k = t.slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      out[k] = v;
    } else {
      out._.push(t);
    }
  }
  return out;
}

const num = (v, dflt) => (v === undefined ? dflt : Number(v));

// ── 主流程 ──────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
const mode = args._[0] || 'help';

if (mode === 'help' || args.help) {
  console.log(fs_text());
  process.exit(0);
}

let svg = '';
let title = '';
let slugBase = 'plot';
let notes = [];

if (mode === 'mistake') {
  // 参数误传诊断：对比"传入的轨道"与"本意应有的轨道"
  const a = num(args.a, NaN);
  const e = num(args.e, 0.05);
  if (!(a > 0)) {
    console.error('用法：node orbit-plot.mjs mistake --a <半长轴km> [--e <偏心率>]');
    console.error('示例：node orbit-plot.mjs mistake --a 700 --e 0.5');
    process.exit(2);
  }

  const per = a * (1 - e);
  let intended = null;
  let reason;

  if (a < EARTH_R) {
    // 最常见：把"轨道高度"当成了"半长轴"
    intended = { semiMajorAxisKm: a + EARTH_R, eccentricity: e };
    reason = `半长轴 ${a} km 小于地球半径 ${EARTH_R} km，`
      + '最常见的成因是把「轨道高度」当成了「半长轴」。'
      + `若本意是高度 ${a} km，则半长轴应为 ${a}+${EARTH_R} = ${a + EARTH_R} km。`;
  } else {
    // 半长轴合理但偏心率过大
    const eMax = Math.max(0, 1 - EARTH_R / a);
    intended = { semiMajorAxisKm: a, eccentricity: Math.min(e, eMax * 0.98) };
    reason = `半长轴 ${a} km 本身合理，但偏心率 ${e} 使近地点降到 ${per.toFixed(1)} km（低于地表）。`
      + `在 a = ${a} km 下，偏心率须小于 ${eMax.toFixed(4)} 才能让近地点高于地表。`;
  }

  notes = [
    { text: `传入：a = ${a} km，e = ${e} → 近地点地心距 ${per.toFixed(1)} km`, tone: 'warn' },
    {
      text: `地球平均半径 ${EARTH_R} km。近地点 ${per.toFixed(1)} km ${per <= EARTH_R ? '低于' : '高于'}该值`
        + ` → ${per <= EARTH_R ? '轨道完全落在地球内部，无物理意义' : '轨道在地表以上，成立'}`,
      tone: per <= EARTH_R ? 'bad' : 'good',
    },
    { text: reason, tone: 'ink' },
    {
      text: `修正后：a = ${intended.semiMajorAxisKm} km，e = ${intended.eccentricity}`
        + ` → 近地点 ${(intended.semiMajorAxisKm * (1 - intended.eccentricity)).toFixed(1)} km`,
      tone: 'good',
    },
  ];

  svg = plotOrbitComparisonImpl({
    target: intended ? { a: intended.semiMajorAxisKm, e: intended.eccentricity } : null,
    actual: { a, e },
    title: '参数诊断：传入的轨道 vs 本意应有的轨道',
    notes,          // ★ 与上面打印的说明是同一个数组 —— 保证图文编号严格一致
  });
  title = `参数诊断 a=${a} e=${e}`;
  slugBase = `mistake-a${a}-e${e}`;

} else if (mode === 'budget') {
  // 误差预算：三项分解 + 瓶颈
  const a = num(args.a, 7000);
  const e = num(args.e, 0.05);
  const steps = num(args.steps, 763);
  const budget = args.budget ? JSON.parse(args.budget) : null;
  if (!budget) {
    console.error('需要 --budget \'{"totalPositionErrorKm":...,"truncationKm":...}\'，'
      + '或改用 orbit_alarm_check 工具先取误差预算。');
    process.exit(2);
  }
  const bnName = budget.bottleneck === 'floating' ? '浮点地板' : '截断误差';
  notes = [
    { text: `总位置误差 ${Number(budget.totalPositionErrorKm).toExponential(3)} km 由三项构成`, tone: 'ink' },
    { text: `截断项 ${Number(budget.truncationKm).toExponential(3)} km —— 缩步长可以降低`, tone: 'bad' },
    { text: `浮点地板 ${Number(budget.floatingFloorKm).toExponential(3)} km —— 双精度下界，缩步长无效`, tone: 'ink' },
    { text: `当前瓶颈：${bnName}（步长 ${steps} 步/圈）`, tone: 'warn' },
  ];
  svg = plotErrorBudgetImpl({ budget, notes });
  title = `误差预算 a=${a} e=${e} steps=${steps}`;
  slugBase = `budget-a${a}-e${e}-n${steps}`;

} else if (mode === 'profile') {
  // 误差沿弧段：说明"末态合格但中段超差"
  const samples = [];
  const n = 60;
  for (let i = 0; i <= n; i++) {
    const t = 1 + i * 5 / n;
    const bump = 3.4e-4 * Math.exp(-Math.pow(t - 3.2, 2) / 1.1);
    samples.push({ t, errKm: bump + 2e-6 });
  }
  notes = [
    { text: '末态误差 2.3e-6 km，远在阈值内 —— 单看末态会判为合格', tone: 'good' },
    { text: '但弧段中段误差涨到 3.4e-4 km，是阈值的 3.4 倍', tone: 'bad' },
    { text: '这就是 R5（弧段外推失效）要抓的情形：末态达标 ≠ 全程达标', tone: 'warn' },
  ];
  svg = plotErrorProfileImpl({
    samples, threshold: 1e-4, thresholdLabel: '位置阈值',
    annotations: [
      { t: 1.0, errKm: 5.5e-5, text: '起点附近，合格' },
      { t: 3.2, errKm: 3.4e-4, text: '中段，超差 3.4 倍' },
      { t: 6.0, errKm: 2.3e-6, text: '末态，回到阈值内' },
    ],
    notes,
  });
  title = '误差沿弧段 R5';
  slugBase = 'profile-R5';

} else if (mode === 'compare') {
  // 两条轨道对比
  const a1 = num(args.a, 7000), e1 = num(args.e, 0.05);
  const a2 = num(args.b, 8000), e2 = num(args.f, 0.02);
  notes = [
    { text: `轨道一：a = ${a1} km，e = ${e1} → 近地点 ${(a1 * (1 - e1)).toFixed(0)} km`, tone: 'ink' },
    { text: `轨道二：a = ${a2} km，e = ${e2} → 近地点 ${(a2 * (1 - e2)).toFixed(0)} km`, tone: 'ink' },
    { text: `两条轨道的近地点相差 ${Math.abs(a1 * (1 - e1) - a2 * (1 - e2)).toFixed(0)} km`, tone: 'warn' },
  ];
  svg = plotOrbitComparisonImpl({
    target: { a: a1, e: e1 },
    actual: { a: a2, e: e2 },
    title: '两条轨道对比',
    notes,
  });
  title = `对比 a=${a1}/${a2}`;
  slugBase = `compare-a${a1}-e${e1}--a${a2}-e${e2}`;

} else {
  console.error(`未知模式：${mode}`);
  console.error(fs_text());
  process.exit(2);
}

// ── 输出 ────────────────────────────────────────────────────
// 文件名用「可读的名字」而不是随机后缀：AGH 只能给路径、用户要自己去找文件，
// 叫 mistake-muvb0hg7.png 根本认不出是哪张。同名会覆盖，避免目录越堆越乱。
mkdirSync(OUT, { recursive: true });
function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-+$/g, '');
}
const fname = slug(slugBase) + '.svg';
const fpath = join(OUT, fname);
writeFileSync(fpath, svg, 'utf-8');

console.log(`已生成 SVG：${fpath}`);
console.log(`大小      ：${(svg.length / 1024).toFixed(1)} KB`);

// 顺便转一份 PNG：AGH 的图片 artifact 只认 PNG/JPEG，且 PNG 双击就能看
let pngPath = null;
try {
  const out = execFileSync(process.execPath, [join(HERE, 'svg2png.mjs'), fpath], {
    encoding: 'utf-8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  pngPath = out.trim().split(/\r?\n/).pop();
  if (pngPath) {
    const sz = statSync(pngPath).size / 1024;
    console.log(`已生成 PNG：${pngPath}`);
    console.log(`            （${sz.toFixed(0)} KB，双击即可打开，推荐用这个）`);
  }
} catch {
  console.log('（PNG 转换未成功，用上面那个 SVG 即可 —— 浏览器能直接打开）');
}

console.log(`标题      ：${title}`);
if (notes.length) {
  console.log('说明（与图上编号一一对应）：');
  notes.forEach((n, i) => console.log(`  ${i + 1}. ${n.text}`));
}

// 写一份说明的 sidecar，供总览页内嵌（file:// 下 fetch 会被拦，所以让总览页读文件）
try {
  const stem = fname.replace(/\.svg$/i, '');
  const sidecar = join(OUT, stem + '.notes.json');
  writeFileSync(sidecar, JSON.stringify({
    title, mode, notes: notes.map((n) => n.text), at: new Date().toISOString(),
  }, null, 1), 'utf-8');
} catch { /* sidecar 失败不影响主流程 */ }

console.log();

// ── 自动打开图片：省掉"复制长路径再去资源管理器粘贴"这一步 ──
// 默认打开 PNG；加 --no-open 可关闭（批量生成时不希望弹一堆窗口）。
const wantOpen = !process.argv.includes('--no-open');
const toOpen = pngPath || fpath;
if (wantOpen && toOpen) {
  try {
    execFileSync('cmd', ['/c', 'start', '', toOpen], { stdio: 'ignore', timeout: 15000 });
    console.log('已自动打开图片。若没弹出，用下面这个路径：');
  } catch {
    console.log('（自动打开失败）直接用这个路径：');
  }
  console.log(`  ${toOpen}`);
} else {
  console.log(`图片路径：${toOpen}`);
}
console.log();
console.log('提示：想看全部历史图，双击桌面上的「看图.cmd」。');

function fs_text() {
  return [
    'orbit-plot —— 轨道诊断图生成器',
    '',
    '用法：',
    '  node orbit-plot.mjs mistake --a <半长轴km> [--e <偏心率>]',
    '      参数误传诊断：对比传入轨道与本意应有的轨道',
    '  node orbit-plot.mjs budget --a <km> --e <e> --steps <n> --budget <json>',
    '      误差预算三项分解（budget 用 orbit_alarm_check 的结果）',
    '  node orbit-plot.mjs profile',
    '      误差沿弧段分布（R5：末态合格但中段超差）',
    '  node orbit-plot.mjs compare --a <km> --e <e> --b <km> --f <e>',
    '      两条轨道对比',
    '',
    '示例：',
    '  node orbit-plot.mjs mistake --a 700 --e 0.5',
  ].join('\n');
}

// ── 绘图实现（转发到 index.mjs 内联的同一批函数）──────────────
// 刻意不复制绘图逻辑：CLI 与插件共用一份实现，避免两边行为漂移。
// 用 function 声明而非 const 箭头函数 —— 声明会提升，
// 避免"定义在使用之后"引发 TDZ 错误（今天已在两处踩到）。
function plotParamMistakeImpl(o) { return need('plotParamMistake')(o); }
function plotOrbitComparisonImpl(o) { return need('plotOrbitComparison')(o); }
function plotErrorBudgetImpl(o) { return need('plotErrorBudget')(o); }
function plotErrorProfileImpl(o) { return need('plotErrorProfile')(o); }

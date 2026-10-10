/**
 * 一键复现：依次运行全部验收脚本，汇总结果
 * ============================================
 * 为什么需要它：项目有 10 个验证/生成脚本，逐个敲命令既麻烦又容易漏。
 * 这个脚本把它们串起来跑一遍，最后给出通过/失败总表。
 *
 * 用法：
 *   node verify-all.mjs           只跑快速集（约 1 分钟内）
 *   node verify-all.mjs --full    跑全部（含网格统计等慢项，数分钟）
 *   node verify-all.mjs --json    以 JSON 输出结果（供程序消费）
 *
 * 退出码：全部通过 → 0；有任何失败 → 1
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const JSON_OUT = argv.includes('--json');

// ── 验收项清单 ────────────────────────────────────────────────
// tier: 'fast' 默认跑；'slow' 需要 --full
const SUITES = [
  {
    file: 'verify-kernel.mjs', name: '内核验证', tier: 'fast',
    desc: 'Python 参考实现 ↔ JS 实现逐项对拍',
  },
  {
    file: 'smoke-tools.mjs', name: '工具冒烟测试', tier: 'fast',
    desc: '五个后端工具的基本调用与返回结构',
  },
  {
    file: 'test-error-budget.mjs', name: '误差预算验收', tier: 'fast',
    desc: '27 项断言：分解自洽 + content 可见性',
  },
  {
    file: 'test-confidence.mjs', name: '统计置信区间验收', tier: 'fast',
    desc: '25 项断言：与 scipy 逐组对拍 + 结构性质',
  },
  {
    file: 'test-external-benchmark.mjs', name: '外部权威基准对拍', tier: 'fast',
    desc: '与 Orekit 官方测试、Curtis 教材例题对拍',
  },
  {
    file: 'transfer-test.mjs', name: '可迁移性验证', tier: 'fast',
    desc: '二体问题 ↔ 简谐振子，同一套判定机制',
  },
  {
    file: 'loop-runner.mjs', name: '四步闭环编排', tier: 'fast',
    desc: '五个目标的完整闭环（含能力边界与非法参数）',
  },
  {
    file: 'diagnose.mjs', name: '方法诊断', tier: 'fast',
    desc: '五种积分器的标定口径与收敛阶实测',
  },
  {
    file: 'grid-eval.mjs', name: '网格统计（六场景 480 单元）', tier: 'slow',
    desc: '误报率/漏报率 + 置信区间，产物为 out/grid-eval.*',
  },
  {
    file: 'integrator-guide.mjs', name: '积分器选型表', tier: 'slow',
    desc: '三档精度 × 四场景的实测步数，产物为 out/integrator-guide.txt',
  },
];

const toRun = SUITES.filter((s) => FULL || s.tier === 'fast');

if (!JSON_OUT) {
  console.log('='.repeat(78));
  console.log('一键复现：项目全部验收项');
  console.log('='.repeat(78));
  console.log(`  模式：${FULL ? '全部（含慢项）' : '快速集'}    共 ${toRun.length} 项`);
  console.log(`  说明：加 --full 可跑全部；加 --json 可机器读取`);
  console.log('');
}

const results = [];
// 记录「子进程根本没起来」的项 —— 它和「脚本跑了但没通过」是两回事，
// 前者说明当前环境不允许建子进程（沙箱常见），需要换 .ps1/.cmd 变体。
const spawnFailures = [];
const t0 = Date.now();

for (let i = 0; i < toRun.length; i++) {
  const s = toRun[i];
  const path = join(HERE, s.file);
  const tag = `[${String(i + 1).padStart(2)}/${toRun.length}]`;

  if (!existsSync(path)) {
    results.push({ ...s, ok: false, ms: 0, note: '脚本不存在' });
    if (!JSON_OUT) console.log(`${tag} ${s.name.padEnd(26)} ✗ 脚本不存在`);
    continue;
  }

  if (!JSON_OUT) process.stdout.write(`${tag} ${s.name.padEnd(26)} 运行中…`);
  const st = Date.now();
  const r = spawnSync(process.execPath, [path], {
    cwd: HERE, encoding: 'utf-8', timeout: 900_000,
  });
  const ms = Date.now() - st;

  // ⚠️ spawnSync 的返回值有两种失败，含义完全不同：
  //    A. 脚本跑起来了、但退出码非零  → r.status 是数字，r.error 为 undefined
  //    B. 子进程**根本没起来**        → r.status 为 null，真正的原因在 r.error
  //       （沙箱禁止建子进程时报 EBUSY / EPERM；找不到解释器报 ENOENT）
  // 早先只判断 `r.status === 0`，把 r.error 整个丢掉 ——
  // 于是在受限环境里八项全报「✗ 0.0s」，看的人完全不知道是环境不允许建子进程。
  // 这里把 error 显式带出来，并把两种情况分开报。
  const spawnErr = r.error
    ? `${r.error.code || r.error.name || 'ERR'}: ${String(r.error.message || '').split('\n')[0]}`
    : '';
  const launched = !r.error;
  const ok = launched && r.status === 0;
  if (!launched) spawnFailures.push(s.name);

  // 从输出里抓一行"通过 N 项"之类的摘要
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(?:验收|对拍|通过)[:：]?\s*通过\s*(\d+)\s*项[，,]?\s*未通过\s*(\d+)\s*项/)
    || out.match(/通过\s*(\d+)\s*项[，,]?\s*未通过\s*(\d+)\s*项/);
  const note = !launched ? `子进程未能启动（${spawnErr}）`
    : m ? `断言 ${m[1]} 通过 / ${m[2]} 未通过` : '';

  results.push({ ...s, ok, ms, note, spawned: launched, spawnError: spawnErr || null });

  if (!JSON_OUT) {
    process.stdout.write(`\r${tag} ${s.name.padEnd(26)} ${ok ? '✓' : '✗'}  ` +
      `${(ms / 1000).toFixed(1)}s${note ? '  ' + note : ''}\n`);
  }
}

const totalMs = Date.now() - t0;
const failed = results.filter((r) => !r.ok);

if (JSON_OUT) {
  console.log(JSON.stringify({
    full: FULL, totalMs, passed: results.length - failed.length,
    failed: failed.length, results,
  }, null, 2));
} else {
  console.log('');
  console.log('='.repeat(78));
  console.log(`结果：通过 ${results.length - failed.length}/${results.length}` +
    `    总耗时 ${(totalMs / 1000).toFixed(1)}s`);
  console.log('='.repeat(78));
  if (failed.length) {
    console.log('');
    console.log('未通过项：');
    for (const r of failed) {
      console.log(`  ✗ ${r.name}（${r.file}）` + (r.note ? `  —— ${r.note}` : ''));
    }
    // 全是「起不动」的话，问题不在被测脚本，而在当前环境 —— 必须说清楚，
    // 否则会被误读成「项目验收不通过」。
    if (spawnFailures.length === results.length && results.length > 0) {
      console.log('');
      console.log('  ⚠️ 以上 ' + spawnFailures.length + ' 项**全部未能启动子进程**，');
      console.log('     这不是脚本本身没过，而是当前环境不允许创建子进程');
      console.log('     （沙箱、受限权限或杀软拦截下常见）。');
      console.log('     请改用不依赖子进程的两个变体之一：');
      console.log('       Windows PowerShell ：  .\\verify-all.ps1');
      console.log('       命令提示符        ：  verify-all.cmd');
      console.log('     或在不受限的终端里重跑本脚本。');
    } else if (spawnFailures.length) {
      console.log('');
      console.log(`  其中 ${spawnFailures.length} 项是子进程未能启动（非脚本问题）：`
        + spawnFailures.join('、'));
    }
  } else {
    console.log('');
    console.log('  ✓ 全部通过');
  }
  if (!FULL) {
    console.log('');
    console.log(`  提示：还有 ${SUITES.length - toRun.length} 项慢验证未跑（网格统计、选型表生成）——`);
    console.log('        需要完整复现时加 --full。');
  }
}

process.exit(failed.length ? 1 : 0);

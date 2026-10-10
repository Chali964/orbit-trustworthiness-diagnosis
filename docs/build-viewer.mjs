#!/usr/bin/env node
/**
 * build-viewer —— 把所有诊断图汇总成一个总览页
 * =============================================
 * 解决什么问题：
 *   Agnes 只能给一个长路径（C:\Users\...\out\plots\xxx.png），
 *   要手动粘到资源管理器才能看，很麻烦。
 *   这个脚本把 out/plots/ 下所有图收进一页 HTML，
 *   双击一个快捷方式就能一次看完，不用输任何路径。
 *
 * 为什么要把说明一起内嵌：
 *   图旁边的编号说明（①②③…）是诊断的核心价值，不该丢。
 *   每张图生成时会写一份同名 .notes.json，这里读出来内嵌进 HTML。
 *   （内嵌而不是 fetch —— file:// 下 fetch 会被浏览器拦掉。）
 *
 * 用法：node build-viewer.mjs [--open]
 */

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLOTS = join(HERE, 'out', 'plots');
const OUT_HTML = join(HERE, 'out', '诊断图总览.html');

if (!existsSync(PLOTS)) {
  console.error('还没有生成过任何图。先在 AGH 里让 Agnes 跑一次诊断，或手动执行：');
  console.error('  node orbit-plot.mjs mistake --a 700 --e 0.5');
  process.exit(1);
}

// ── 收集：每张图 = 一个 PNG + 可选同名 notes.json ──────────────
const files = readdirSync(PLOTS);
const pngs = files.filter((f) => f.toLowerCase().endsWith('.png'));

const items = pngs.map((png) => {
  const stem = basename(png, extname(png));
  const p = join(PLOTS, png);
  const st = statSync(p);
  let meta = null;
  const nj = join(PLOTS, stem + '.notes.json');
  if (existsSync(nj)) {
    try {
      meta = JSON.parse(readFileSync(nj, 'utf-8'));
    } catch {
      meta = null;
    }
  }
  return { png, stem, sizeKB: st.size / 1024, mtime: st.mtimeMs, meta };
}).sort((a, b) => b.mtime - a.mtime);   // 最新的排前面

if (items.length === 0) {
  console.error('out/plots/ 里没有 PNG。');
  process.exit(1);
}

// ── 生成 HTML（图片用 base64 内嵌，避免 file:// 下相对路径不稳）──
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const fmtTime = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const blocks = items.map((it) => {
  const b64 = readFileSync(join(PLOTS, it.png)).toString('base64');
  const title = it.meta?.title || it.stem;
  const notes = Array.isArray(it.meta?.notes) ? it.meta.notes : [];
  return `
  <section class="card">
    <header>
      <h2>${esc(title)}</h2>
      <div class="sub">${esc(it.png)} ｜ ${it.sizeKB.toFixed(0)} KB ｜ ${fmtTime(it.mtime)}</div>
    </header>
    <figure><img alt="${esc(title)}" src="data:image/png;base64,${b64}"></figure>
    ${notes.length ? `<details class="notes-wrap">
      <summary>图上说明的文字版（${notes.length} 条，便于复制）</summary>
      <ol class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ol>
    </details>` : ''}
  </section>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>轨道诊断图总览</title>
<style>
  :root{--bg:#f6f7f9;--card:#fff;--line:#e3e6ec;--ink:#1a1f29;--ink2:#3f4959;--ink3:#7b869a;--brand:#1d5fd0;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-size:15px;line-height:1.75;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
  .wrap{max-width:1060px;margin:0 auto;padding:26px 20px 70px}
  h1{font-size:24px;margin:0 0 4px}
  .kicker{font-size:12.4px;letter-spacing:.16em;color:var(--ink3);margin-bottom:6px}
  .hint{font-size:13.6px;color:var(--ink2);background:#eaf1fd;border:1px solid #cfe0fa;
    border-radius:9px;padding:11px 15px;margin:16px 0 24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:18px 20px 20px;margin:20px 0;box-shadow:0 1px 3px rgba(20,30,50,.05)}
  .card header h2{font-size:17px;margin:0 0 3px}
  .card .sub{font-size:12.4px;color:var(--ink3);margin-bottom:12px;font-family:ui-monospace,Consolas,monospace}
  figure{margin:0;border:1px solid var(--line);border-radius:9px;overflow:hidden;background:#fff;font-size:0}
  figure img{display:block;width:100%;height:auto}
  .notes-wrap{margin:13px 0 0;border:1px solid var(--line);border-radius:8px;background:#fbfcfe}
  .notes-wrap>summary{cursor:pointer;padding:9px 14px;font-size:13.4px;color:var(--ink2);font-weight:600}
  .notes-wrap>summary:hover{color:var(--brand)}
  .notes{margin:0;padding:4px 24px 14px 40px;font-size:14.2px;color:var(--ink2)}
  .notes li{margin:5px 0}
  .notes li::marker{color:var(--brand);font-weight:700}
  footer{margin-top:34px;padding-top:14px;border-top:1px solid var(--line);font-size:12.6px;color:var(--ink3)}
</style></head><body><div class="wrap">
<div class="kicker">轨道仿真可信度诊断</div>
<h1>诊断图总览</h1>
<div class="hint">
  共 <b>${items.length}</b> 张，最新的在最上面。图旁的编号说明与图上标注一一对应。<br>
  新生成的图不会自动出现在这里 —— <b>再双击一次「看图.cmd」即可刷新</b>。
</div>
${blocks}
<footer>由 build-viewer.mjs 生成 ｜ 图源目录：agh-orbit-plugin/out/plots/</footer>
</div></body></html>`;

writeFileSync(OUT_HTML, html, 'utf-8');
const sizeKB = statSync(OUT_HTML).size / 1024;
console.log(`总览页已生成：${OUT_HTML}`);
console.log(`  含 ${items.length} 张图，共 ${sizeKB.toFixed(0)} KB`);
items.slice(0, 6).forEach((it) => console.log(`    - ${it.png}`));

if (process.argv.includes('--open')) {
  try {
    execFileSync('cmd', ['/c', 'start', '', OUT_HTML], { stdio: 'ignore' });
    console.log('  已在浏览器中打开。');
  } catch {
    console.log('  （自动打开失败，双击上面那个 HTML 即可）');
  }
}

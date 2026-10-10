#!/usr/bin/env node
/**
 * svg2png —— 把 SVG 转成 PNG（用系统自带的 Edge 无头模式）
 * =========================================================
 * 为什么需要它：
 *   AGH 的图片 artifact 只接受 PNG / JPEG（源码里 mime 是
 *   Type.Union([Literal("image/png"), Literal("image/jpeg")])），SVG 不在其列。
 *   而且 SVG 双击打不开（很多系统没关联看图程序），PNG 双击就能看。
 *
 * 用法：node svg2png.mjs <输入.svg> [输出.png] [宽] [高]
 * 退出码：0 成功；1 失败（此时仍可用原 SVG）
 */

import { existsSync, statSync, unlinkSync } from 'node:fs';
import * as io from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, basename, resolve } from 'node:path';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const [, , inSvg, outPngArg, wArg, hArg] = process.argv;
if (!inSvg) {
  console.error('用法：node svg2png.mjs <输入.svg> [输出.png] [宽] [高]');
  process.exit(1);
}
const src = resolve(inSvg);
if (!existsSync(src)) {
  console.error('找不到输入文件：' + src);
  process.exit(1);
}

const outPng = outPngArg ? resolve(outPngArg)
  : join(dirname(src), basename(src).replace(/\.svg$/i, '') + '.png');

// 截图区域要贴合 SVG 的真实尺寸，否则四周会留一大圈白边
// （SVG 是 860x520，若按 1100x800 截，卡片里就会出现无意义的空白）
function svgSize(text) {
  const vb = /viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/i.exec(text);
  if (vb) return [Math.ceil(Number(vb[3])), Math.ceil(Number(vb[4]))];
  const w = /\bwidth\s*=\s*["'](\d+)/i.exec(text);
  const h = /\bheight\s*=\s*["'](\d+)/i.exec(text);
  if (w && h) return [Number(w[1]), Number(h[1])];
  return [1100, 800];
}
const [svgW, svgH] = svgSize(io.readFileSync(src, 'utf-8'));
const W = Number(wArg) || svgW;
const H = Number(hArg) || svgH;

const browser = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('没找到 Edge / Chrome，无法转换。');
  console.error('提示：SVG 本身是完好的，用浏览器直接打开也可以。');
  process.exit(1);
}

try {
  if (existsSync(outPng)) unlinkSync(outPng);
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=2',            // 2 倍像素密度，投影/打印更清晰
    `--screenshot=${outPng}`,
    `--window-size=${W},${H}`,
    'file:///' + src.replace(/\\/g, '/'),
  ], { stdio: 'ignore', timeout: 60000 });

  if (!existsSync(outPng) || statSync(outPng).size === 0) {
    console.error('转换后没有得到 PNG。');
    process.exit(1);
  }
  console.log(outPng);
  process.exit(0);
} catch (e) {
  console.error('转换失败：' + (e && e.message ? e.message : e));
  process.exit(1);
}

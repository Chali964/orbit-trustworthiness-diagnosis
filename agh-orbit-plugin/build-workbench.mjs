/**
 * 构建脚本：把 AGH 插件内核注入工作台页面，消除「同一套物理两份实现」的漂移源
 * ============================================================================
 * 背景
 *   agh-orbit-plugin/index.mjs 是内核的单一来源；轨道仿真可信度工作台.html 里
 *   另有一份手写的物理内核（常量、开普勒求解、五个推进器、发散判据）。
 *   两份实现已经发生过一次真实漂移：插件改了发散判据（远地点×2）与报警口径
 *   （R3 改位置口径、补 R6），工作台还是旧版 —— 同一现象会给出不同结论。
 *
 * 做法
 *   ① 读 index.mjs，剥掉 ESM 的 export，包成 IIFE，对外只暴露一个全局 AGH 对象；
 *   ② 在工作台页面里把原来那份手写物理换成「生成的 AGH + 一层薄适配」；
 *   ③ 适配层保留工作台原有的符号名（MU / A / ECC / PERIOD / DIM_LIMIT / METHODS /
 *      exactState / energyOf / deriv），因此页面其余代码一行都不用改。
 *
 * 幂等
 *   首次运行会识别原始物理块；之后运行只替换 /* ===== KERNEL:BEGIN ===== *​/ 与
 *   /* ===== KERNEL:END ===== *​/ 之间的内容，可反复重建而不会层层嵌套。
 *
 * 运行：node agh-orbit-plugin/build-workbench.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const KERNEL_PATH = join(here, 'index.mjs')
const PAGE_PATH = join(root, '轨道仿真可信度工作台.html')

const BEGIN = '/* ===== KERNEL:BEGIN（由 agh-orbit-plugin/index.mjs 生成，勿手改） ===== */'
const END = '/* ===== KERNEL:END ===== */'

// ---------------------------------------------------------------- 取出内核源码
let kernelSrc = readFileSync(KERNEL_PATH, 'utf8')

// 剥掉尾部的 ESM 导出（浏览器 <script> 里不允许 export）
const cut = kernelSrc.indexOf('export const orbitToolkit')
if (cut < 0) throw new Error('未找到 export const orbitToolkit，内核文件结构可能已变化')
kernelSrc = kernelSrc.slice(0, cut).replace(/^\s*export\s+/gm, '')

const EXPORTS = ['EARTH_MU', 'EPS', 'SYSTEMS', 'SYSTEM_KEYS', 'makeScenario', 'DEFAULT_SCENARIO',
  'resolveScenario', 'solveKepler', 'exactState', 'deriv', 'energy', 'angularMomentum',
  'METHODS', 'METHOD_NAMES', 'propagate', 'orderTest', 'calibrateTruncation', 'probeFloor',
  'calibrateStep', 'alarmCheck', 'describeScenario', 'scenarioLine',
  'decideRules', 'ALARM_RULES', 'ALARM_SEVERITY', 'FATAL_RULES']

const bundle = [
  BEGIN,
  'var AGH=(function(){',
  kernelSrc.trimEnd(),
  'return {' + EXPORTS.map((k) => `${k}:${k}`).join(',') + '};',
  '})();',
  '',
  '/* ---- 适配层：把单一来源的内核接到工作台原有的符号名上 ---- */',
  'var MU=AGH.EARTH_MU;',
  'var A=AGH.DEFAULT_SCENARIO.a, ECC=AGH.DEFAULT_SCENARIO.e;',
  'var N_MEAN=AGH.DEFAULT_SCENARIO.nMean, PERIOD=AGH.DEFAULT_SCENARIO.period;',
  'var DIM_LIMIT=AGH.DEFAULT_SCENARIO.dimLimit;',
  'function solveKepler(M0,e){ return AGH.solveKepler(M0,e); }',
  'function exactState(t){ return AGH.exactState(t, AGH.DEFAULT_SCENARIO); }',
  'function deriv(s){ return AGH.deriv(s, AGH.DEFAULT_SCENARIO); }',
  'function energyOf(s){ return AGH.energy(s, AGH.DEFAULT_SCENARIO); }',
  'var METHODS=(function(){',
  '  var COLOR={rk4:"#1d5fd0", heun:"#1f7a4d", midpoint:"#0f8b8d", leapfrog:"#9a6200", euler:"#c62828"};',
  '  var out={};',
  '  AGH.METHOD_NAMES.forEach(function(k){',
  '    out[k]={ name:AGH.METHODS[k].name, order:AGH.METHODS[k].order, color:COLOR[k],',
  '             step:function(s,dt){ return AGH.METHODS[k].step(s,dt,AGH.DEFAULT_SCENARIO); } };',
  '  });',
  '  return out;',
  '})();',
  END,
].join('\n')

// ---------------------------------------------------------------- 替换页面里的物理块
let page = readFileSync(PAGE_PATH, 'utf8')

// 原始物理块的起止用正则匹配，避免受缩进/换行细节影响
const ORIG_START_RE = /\/\*\s*=+\s*\n\s*共享物理内核：解析真值 \+ 五种积分器\s*\n\s*=+\s*\*\//
const ORIG_END_RE = /function energyOf\(s\)\{[^}]*Math\.hypot\(s\[0\],s\[1\]\);\s*\}/

function replaceBlock(html) {
  const b = html.indexOf(BEGIN)
  const e = html.indexOf(END)
  if (b >= 0 && e > b) {
    // 已生成过：只替换标记之间的内容
    return { html: html.slice(0, b) + bundle + html.slice(e + END.length), mode: '重建（替换已有生成块）' }
  }
  const sm = ORIG_START_RE.exec(html)
  if (sm) {
    const tail = html.slice(sm.index + sm[0].length)
    const em = ORIG_END_RE.exec(tail)
    if (!em) throw new Error('找到物理块起始但没找到 energyOf 结束行')
    return {
      html: html.slice(0, sm.index) + bundle + tail.slice(em.index + em[0].length),
      mode: '首次生成（替换原始手写物理块）',
    }
  }
  throw new Error('页面里既没有生成块标记，也没有原始物理块 —— 页面结构可能已变化')
}

const { html: out, mode } = replaceBlock(page)
writeFileSync(PAGE_PATH, out, 'utf8')

console.log(`已注入内核：${mode}`)
console.log(`  内核来源：${KERNEL_PATH}`)
console.log(`  目标页面：${PAGE_PATH}`)
console.log(`  生成块大小：${(bundle.length / 1024).toFixed(1)} KB`)
console.log(`  页面大小：${(page.length / 1024).toFixed(1)} KB → ${(out.length / 1024).toFixed(1)} KB`)
console.log('  适配层保留的符号：MU / A / ECC / N_MEAN / PERIOD / DIM_LIMIT / METHODS / exactState / deriv / energyOf')
console.log('  → 页面其余代码无需改动；今后改内核只需重跑本脚本。')

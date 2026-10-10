/**
 * Python ↔ JavaScript 内核对拍（V&V 第 2 级：代码间比对）
 * ============================================================================
 * 目的
 *   证明 agh-orbit-plugin/index.mjs 的 JS 内核与 orbit-demo/*.py 的 Python
 *   参考实现算的是同一件事。这是把数值内核搬进 AGH 的前置条件：内核跑在
 *   AGH 进程里（JS），但真值基准是在 Python 里标定的，两者必须一致。
 *
 * 判据（三条同时满足才算通过）
 *   C1 量级一致：|log10(a) − log10(b)| ≤ 0.05 dex（≈12%），适用于有效样本
 *   C2 噪声底豁免：a、b 都低于 NOISE（100ε）时判为「已在噪声底，不比较」
 *      理由：贴 ε 的量是舍入随机结果，两次实现差一个末位就能翻倍，
 *            用相对偏差判这类量会把「一致的随机噪声」误报成「实现不一致」
 *   C3 发散标志一致
 *   不追求逐位一致的原因：Math.pow 与 Python ** 的末位实现不同，
 *   经上千步放大后必然渗透到截断误差项；对拍要证的是「同一个模型」，
 *   不是「同一串比特」。
 *
 * 运行：node agh-orbit-plugin/verify-kernel.mjs
 *   退出码 0 = 全部通过；1 = 存在真正超差项
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { __kernel } from './index.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Python 参考实现的输出位置。列多个候选而不写死单一路径 ——
// 目录结构一旦调整（例如打包移交时重新归类），写死的相对路径就会失效。
// 按优先级依次尝试，找到第一个存在的。
const REF_CANDIDATES = [
  join(here, '..', 'orbit-demo', 'out', 'reference-js-crosscheck.json'),              // 开发目录：同级
  join(here, '..', '..', '示例数据', 'orbit-demo', 'out', 'reference-js-crosscheck.json'), // 移交包：源码/ 与 示例数据/ 同级
  join(here, '..', '示例数据', 'orbit-demo', 'out', 'reference-js-crosscheck.json'),       // 移交包：示例数据/ 在源码/ 内
  join(here, '..', 'orbit-demo', 'out', 'reference-js-crosscheck.json'),
]
const refPath = REF_CANDIDATES.find((p) => existsSync(p))
if (!refPath) {
  console.error('找不到 Python 参考实现输出 reference-js-crosscheck.json。')
  console.error('已尝试以下位置：')
  for (const p of REF_CANDIDATES) console.error('  ' + p)
  console.error('请先运行 orbit-demo/dump-reference.py 生成它。')
  process.exit(1)
}
const ref = JSON.parse(readFileSync(refPath, 'utf8'))

const DEX_TOL = 0.05             // C1：对数偏差上限（dex）
const NOISE = 100 * Number.EPSILON  // C2：噪声底门槛 ≈ 2.22e-14

function dexDev(a, b) {
  if (!(a > 0) || !(b > 0)) return null
  return Math.abs(Math.log10(a) - Math.log10(b))
}

function judge(name, a, b) {
  if (a < NOISE && b < NOISE) return { name, a, b, status: 'N/A', note: '两者都在噪声底' }
  const d = dexDev(a, b)
  if (d === null) return { name, a, b, status: 'FAIL', note: '非正数，无法比较' }
  return { name, a, b, status: d <= DEX_TOL ? 'OK' : 'FAIL', dex: d }
}

console.log('='.repeat(96))
console.log('Python ↔ JavaScript 内核对拍（V&V 第 2 级：代码间比对）')
console.log('判据：量级一致（≤ ' + DEX_TOL + ' dex）＋ 噪声底豁免（< ' + NOISE.toExponential(1) + '）＋ 发散标志一致')
console.log('='.repeat(96))

let rows = 0, okRows = 0, badRows = 0, exempted = 0
const problemFields = []

for (const r of ref) {
  rows++
  const js = __kernel.propagate({ method: r.method, nPerOrbit: r.nPerOrbit, orbits: r.orbits, t0: r.t0 })
  const fields = [
    judge('位置误差', r.positionErrorKm, js.positionErrorKm),
    judge('比能量', r.relEnergyError, js.relEnergyError),
    judge('比角动量', r.relAngularMomentumError, js.relAngularMomentumError),
  ]
  const flags = fields.map((f) => f.status)
  const divergedOk = r.diverged === js.diverged
  const pass = flags.every((s) => s !== 'FAIL') && divergedOk
  if (pass) okRows++; else badRows++
  exempted += flags.filter((s) => s === 'N/A').length

  console.log('')
  console.log(`[${pass ? '通过' : '超差'}] ${r.method}  每圈 ${r.nPerOrbit} 步  积分 ${r.orbits} 圈  t0=${r.t0.toFixed(3)} s`)
  for (const f of fields) {
    const tag = f.status === 'N/A' ? '（噪声底豁免）' : f.status === 'OK' ? '' : '  ← 超差'
    const dex = f.dex === undefined ? '' : '  dex=' + f.dex.toFixed(5)
    console.log(`    ${f.name.padEnd(6)}  Py=${f.a.toExponential(4)}  JS=${f.b.toExponential(4)}  ${f.status}${dex}${tag}`)
    if (f.status === 'FAIL') problemFields.push(`${r.method}@n=${r.nPerOrbit}/${f.name}`)
  }
  console.log(`    发散标志  Py=${r.diverged}  JS=${js.diverged}  ${divergedOk ? 'OK' : 'FAIL'}`)
}

console.log('')
console.log('-'.repeat(96))
console.log(`合计 ${rows} 组用例：通过 ${okRows}，超差 ${badRows}；噪声底豁免 ${exempted} 个字段`)
if (problemFields.length) console.log('超差字段：' + problemFields.join('、'))

// ---- JS 侧独立复核 ----
console.log('')
console.log('='.repeat(96))
console.log('附：JS 侧独立复核（这些不是对拍项，是接入后要用的能力）')
console.log('='.repeat(96))
const orderR = __kernel.orderTest({ method: 'rk4', orbits: 2, nList: [50, 100, 200, 400, 800, 1600] })
console.log(`RK4 观察阶测试：拟合实测阶 ${orderR.fittedOrderPos.toFixed(3)}（理论 4），判定 ${orderR.verdict}`)
for (const it of orderR.intervals) {
  console.log(`  ${String(it.from).padStart(5)} → ${String(it.to).padEnd(5)} 位置阶 ${it.observedOrderPos.toFixed(3)}｜能量阶 ${it.observedOrderEnergy.toFixed(3)}｜角动量阶 ${it.observedOrderAngMom.toFixed(3)}`)
}
const eulerR = __kernel.propagate({ method: 'euler', nPerOrbit: 5, orbits: 2 })
console.log(`欧拉法 n=5：发散=${eulerR.diverged}，第 ${eulerR.steps} 步终止（发散判定有效）`)

const cal = __kernel.calibrateTruncation({ method: 'rk4', orbits: 2 })
const floor = __kernel.probeFloor({ method: 'rk4', orbits: 2 })
console.log(`截断标定：比能量 E ≈ ${cal.eeA.toExponential(4)}·h^${cal.eePower.toFixed(3)}；位置 E ≈ ${cal.posA.toExponential(4)}·h^${cal.posPower.toFixed(3)}`)
console.log(`精度平台：比能量 ${floor.floorEnergy.toExponential(3)}（散布 ${floor.floorEnergyMin.toExponential(2)} ~ ${floor.floorEnergyMax.toExponential(2)}）`)

// ---- 用真实工具入口跑一遍，确认注册对象可用 ----
console.log('')
console.log('工具自检（直接调用 execute，验证参数校验与返回结构）')
for (const t of __kernel.TOOLS) {
  let args = {}
  if (t.name === 'orbit_propagate') args = { method: 'rk4', nPerOrbit: 400, orbits: 2 }
  if (t.name === 'orbit_order_test') args = { method: 'rk4', orbits: 2, nList: [50, 100, 200, 400] }
  if (t.name === 'orbit_calibrate_step') args = { method: 'rk4', orbits: 2, targetRelEnergyErr: 1e-11 }
  if (t.name === 'orbit_alarm_check') args = { method: 'rk4', nPerOrbit: 400, orbits: 2 }
  const res = await t.execute(args)
  const head = res.content[0].text.split('\n')[0]
  console.log(`  ✓ ${t.name.padEnd(22)} → ${head.slice(0, 78)}`)
}

console.log('')
const finalPass = badRows === 0
console.log(finalPass
  ? '✓ 对拍通过：JS 内核与 Python 参考实现一致，可作为 AGH 内的执行内核。'
  : '✗ 存在真正超差项，需先定位差异再接入。')
process.exit(finalPass ? 0 : 1)

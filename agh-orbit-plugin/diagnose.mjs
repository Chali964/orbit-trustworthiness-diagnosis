/**
 * 诊断：找出当前实现里真实存在的缺陷（不猜，用数据说话）
 * ============================================================================
 * D1 标定式的拟合优度：写死的拟合区间 [50..1600] 对每种方法都成立吗？
 *    重点怀疑对象：前向欧拉。二体问题的显式欧拉是条件不稳定的，
 *    误差按指数增长而非幂律，用幂律拟合可能得到「假幂次」。
 * D2 拟合区间敏感性：换一个区间拟合，A 和 p 会差多少？
 *    若差别很大，说明标定结果依赖于人为选点，不可靠。
 * D3 发散判据：DIM_LIMIT = a×3 对不同偏心率是否合理？
 * D4 平台守卫：五个方法各自的精度平台探测结果
 *
 * 运行：node agh-orbit-plugin/diagnose.mjs
 */

import { __kernel } from './index.mjs'

const K = __kernel
const f = (v, d = 3) => (v === null || v === undefined ? '未测出' : Number(v).toExponential(d))
const bar = (c = '=') => console.log(c.repeat(96))

const NS = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600]
const ORB = 2

// ---------------------------------------------------------------- D1 / D2
function collect(method) {
  return NS.map((n) => {
    const r = K.propagate({ method, nPerOrbit: n, orbits: ORB })
    return { n, pos: r.positionErrorKm, ee: r.relEnergyError, diverged: r.diverged }
  })
}

function fitWindow(rows, idx, lo, hi) {
  const xs = [], ys = []
  for (const r of rows) {
    if (r.n < lo || r.n > hi) continue
    const v = idx === 'pos' ? r.pos : r.ee
    if (!(v > 0) || !Number.isFinite(v)) return null
    xs.push(Math.log(r.n)); ys.push(Math.log(v))
  }
  if (xs.length < 3) return null
  const m = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / m
  const my = ys.reduce((a, b) => a + b, 0) / m
  let sxx = 0, sxy = 0
  for (let i = 0; i < m; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my) }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  // R² 与残差标准差（dex）
  const ss = ys.reduce((a, y) => a + (y - my) ** 2, 0)
  const ssr = ys.reduce((a, y, i) => a + (y - (intercept + slope * xs[i])) ** 2, 0)
  const r2 = ss > 0 ? 1 - ssr / ss : 1
  const residDex = Math.sqrt(ssr / m) / Math.LN10
  const power = -slope
  const A = Math.exp(intercept) / K.PERIOD ** power
  return { power, A, r2, residDex, count: m }
}

function localPower(rows, idx, n0, n1) {
  const a = rows.find((r) => r.n === n0)
  const b = rows.find((r) => r.n === n1)
  if (!a || !b) return NaN
  const v0 = idx === 'pos' ? a.pos : a.ee
  const v1 = idx === 'pos' ? b.pos : b.ee
  if (!(v0 > 0 && v1 > 0)) return NaN
  return Math.log(v0 / v1) / Math.log(n1 / n0)
}

console.log('')
bar()
console.log('D1　标定式的拟合优度：写死的拟合区间 [50..1600] 对每种方法都成立吗？')
bar()
console.log(`${'方法'.padEnd(11)}${'理论阶'.padEnd(9)}${'拟合幂次'.padEnd(12)}${'R²'.padEnd(12)}${'残差(dex)'.padEnd(13)}逐段局部幂次（每档翻倍）`)
console.log('-'.repeat(96))
for (const method of K.METHOD_NAMES) {
  const rows = collect(method)
  const fit = fitWindow(rows, 'ee', 50, 1600)
  const locals = []
  for (let i = 1; i < rows.length; i++) {
    const p = localPower(rows, 'ee', rows[i - 1].n, rows[i].n)
    locals.push(Number.isFinite(p) ? p.toFixed(2) : ' -- ')
  }
  const theory = K.METHODS[method].order
  console.log(`${method.padEnd(11)}${String(theory).padEnd(9)}${fit.power.toFixed(3).padEnd(12)}`
    + `${fit.r2.toFixed(5).padEnd(12)}${fit.residDex.toFixed(3).padEnd(13)}${locals.join('  ')}`)
}
console.log('-'.repeat(96))
console.log('读法：局部幂次若在各档之间大幅漂移（不是稳定常数），说明该方法的误差不服从幂律，')
console.log('      幂律拟合出的 p 与 A 是「假值」，据此反推的步长不可信。')
console.log('      参考：RK4 理论幂次 5.000（守恒量口径）。')

console.log('')
bar()
console.log('D2　拟合区间敏感性：换一个拟合窗口，A 和 p 会差多少？')
bar()
const WINDOWS = [[50, 400], [50, 1600], [200, 3200], [400, 6400], [800, 6400]]
const baseLine = {}
console.log(`${'方法'.padEnd(11)}` + WINDOWS.map((w) => `[${w[0]},${w[1]}]`.padEnd(17)).join(''))
console.log(`（每格：p / A）`)
console.log('-'.repeat(96))
for (const method of K.METHOD_NAMES) {
  const rows = collect(method)
  const cells = []
  for (const [lo, hi] of WINDOWS) {
    const fit = fitWindow(rows, 'ee', lo, hi)
    if (!fit) { cells.push('窗口内样本不足'.padEnd(17)); continue }
    cells.push((`${fit.power.toFixed(2)} / ${fit.A.toExponential(2)}`).padEnd(17))
    if (lo === 50 && hi === 1600) baseLine[method] = fit.A
  }
  console.log(`${method.padEnd(11)}` + cells.join(''))
}
console.log('-'.repeat(96))
console.log('读法：同一方法在不同窗口下若 A 相差几个数量级，说明标定结果依赖于人为选点，不是物理量。')

console.log('')
bar()
console.log('D3　发散判据：DIM_LIMIT = a×3 是否随偏心率失效？')
bar()
console.log(`  当前实现：DIM_LIMIT = ${K.A_SEMI} × 3 = ${(K.A_SEMI * 3).toFixed(0)} km（硬编码）`)
console.log(`${'偏心率 e'.padEnd(12)}${'远地点 (km)'.padEnd(15)}${'DIM_LIMIT/远地点'.padEnd(20)}判定余量`)
console.log('-'.repeat(96))
for (const e of [0.0, 0.05, 0.3, 0.6, 0.8, 0.9]) {
  const ra = K.A_SEMI * (1 + e)
  const ratio = (K.A_SEMI * 3) / ra
  const verdict = ratio > 2.5 ? '充裕' : ratio > 1.8 ? '偏紧' : '危险（接近误判）'
  console.log(`${String(e).padEnd(12)}${ra.toFixed(1).padEnd(15)}${ratio.toFixed(2).padEnd(20)}${verdict}`)
}
console.log('-'.repeat(96))
console.log('  问题：判据是「相对 a 的绝对距离」，但轨道的实际尺度是「远地点」。')
console.log('        e 越大，远地点越接近 3a，判定余量越小，会把正常轨道误判为发散。')

console.log('')
bar()
console.log('D4　平台守卫：五个方法各自的精度平台探测结果')
bar()
const cal = K.calibrateTruncation({ method: 'rk4', orbits: ORB })
console.log(`${'方法'.padEnd(11)}${'位置平台达否'.padEnd(16)}${'守恒量平台达否'.padEnd(18)}${'平台说明'.padEnd(30)}`)
console.log('-'.repeat(96))
for (const method of K.METHOD_NAMES) {
  const fl = K.probeFloor({ method, orbits: ORB })
  console.log(`${method.padEnd(11)}${(fl.posFloorReached ? '已到达' : '未到达').padEnd(16)}`
    + `${(fl.energyFloorReached ? '已到达' : '未到达').padEnd(18)}`
    + `${fl.floorNote.slice(0, 28)}`)
}
console.log('-'.repeat(96))
console.log('读法：低阶方法（欧拉/休恩/中点）的平台在 20000 步/圈处仍未触到，')
console.log('      因此它们的「下界上限」只能保守取探针步数，这是已知限制而非缺陷。')

console.log('')
bar()
console.log('D5　外推检验能否兜住「拟合窗口滑进平台区」这一风险？')
bar()
console.log('  背景：标定式的拟合窗口目前写死为 [50..1600]。若窗口包含平台区，')
console.log('        拟合出的幂次会被拉低、A 被抬高，反推的步长随之失真。')
console.log('        问题是：新增的外推检验（对窗口外下一档的预测偏差 ≤ 0.30 dex）能否抓到？')
console.log('')
console.log(`${'方法'.padEnd(11)}${'窗口'.padEnd(15)}${'p'.padEnd(9)}${'R²'.padEnd(10)}${'外推偏差(dex)'.padEnd(15)}外推检验`)
console.log('-'.repeat(96))
for (const method of ['rk4', 'heun', 'midpoint', 'leapfrog']) {
  const rows = collect(method)
  for (const [lo, hi] of [[50, 1600], [400, 6400], [800, 6400]]) {
    const fit = fitWindow(rows, 'ee', lo, hi)
    if (!fit) continue
    const nNext = hi * 2
    const nextRow = rows.find((r) => r.n === nNext)
    // 窗口内最大档之外的下一档，用同一条幂律外推
    const hNext = K.PERIOD / nNext
    const pred = fit.A * hNext ** fit.power
    let dex = '样本超出测量范围'
    let verdict = '—'
    if (nextRow && nextRow.ee > 0 && pred > 0) {
      const d = Math.abs(Math.log10(pred / nextRow.ee))
      dex = d.toFixed(2)
      verdict = d <= 0.30 ? '通过' : '✗ 拦下'
    }
    console.log(`${method.padEnd(11)}${`[${lo},${hi}]`.padEnd(15)}${fit.power.toFixed(3).padEnd(9)}`
      + `${fit.r2.toFixed(5).padEnd(10)}${String(dex).padEnd(15)}${verdict}`)
  }
}
console.log('-'.repeat(96))
console.log('读法：窗口滑进平台区时，外推检验应判「拦下」，标定随即被标记为不可靠、不返回步数。')
console.log('      若成立，则「窗口写死」这一隐患已被兜住——选错窗口不会给错数字，只会说不可靠。')

console.log('')
bar()
console.log('诊断完成')
bar()

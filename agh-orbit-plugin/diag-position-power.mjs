import { __kernel as K } from './index.mjs'
const NS = [50, 100, 200, 400, 800, 1600, 3200, 6400]
function loc(rows, idx, n0, n1) {
  const a = rows.find((r) => r.n === n0), b = rows.find((r) => r.n === n1)
  const v0 = idx === 'pos' ? a.pos : a.ee, v1 = idx === 'pos' ? b.pos : b.ee
  return (v0 > 0 && v1 > 0) ? Math.log(v0 / v1) / Math.log(n1 / n0) : NaN
}
function fit(rows, idx, lo, hi) {
  const xs = [], ys = []
  for (const r of rows) {
    if (r.n < lo || r.n > hi) continue
    const v = idx === 'pos' ? r.pos : r.ee
    if (!(v > 0)) return null
    xs.push(Math.log(r.n)); ys.push(Math.log(v))
  }
  const m = xs.length, mx = xs.reduce((a, b) => a + b) / m, my = ys.reduce((a, b) => a + b) / m
  let sxx = 0, sxy = 0
  for (let i = 0; i < m; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my) }
  const sl = sxy / sxx, ic = my - sl * mx
  const ss = ys.reduce((a, y) => a + (y - my) ** 2, 0)
  const ssr = ys.reduce((a, y, i) => a + (y - (ic + sl * xs[i])) ** 2, 0)
  return { p: -sl, r2: ss > 0 ? 1 - ssr / ss : 1, resid: Math.sqrt(ssr / m) / Math.LN10 }
}
console.log('各方法在「位置口径」下的幂律性（拟合窗口 [50,1600]）')
console.log('方法'.padEnd(11) + '理论阶'.padEnd(9) + '拟合p'.padEnd(9) + 'R²'.padEnd(11) + '残差dex'.padEnd(10) + '逐段局部幂次')
console.log('-'.repeat(94))
for (const M of K.METHOD_NAMES) {
  const rows = NS.map((n) => {
    const r = K.propagate({ method: M, nPerOrbit: n, orbits: 2 })
    return { n, pos: r.positionErrorKm, ee: r.relEnergyError }
  })
  const fp = fit(rows, 'pos', 50, 1600), fe = fit(rows, 'ee', 50, 1600)
  const L = []
  for (let i = 1; i < rows.length; i++) { const p = loc(rows, 'pos', rows[i - 1].n, rows[i].n); L.push(Number.isFinite(p) ? p.toFixed(2) : ' -- ') }
  console.log(M.padEnd(11) + String(K.METHODS[M].order).padEnd(9) + fp.p.toFixed(3).padEnd(9) + fp.r2.toFixed(5).padEnd(11) + fp.resid.toFixed(3).padEnd(10) + L.join('  '))
  console.log(''.padEnd(32) + `守恒量口径：p=${fe.p.toFixed(3)}  R²=${fe.r2.toFixed(5)}  残差=${fe.resid.toFixed(3)}`)
}

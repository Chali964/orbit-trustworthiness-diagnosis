import { __kernel as K } from './index.mjs'

const sc = K.makeScenario({ system: 'sho', amplitudeKm: 7000, periodSeconds: 5828.517 })
console.log('简谐振子：各方法的双口径幂律性（窗口 50..1600，2 圈）')
console.log('方法'.padEnd(11) + '理论阶'.padEnd(9) + '位置 p/R²'.padEnd(21) + '守恒量 p/R²'.padEnd(21) + '逐段局部幂次（守恒量）')
console.log('-'.repeat(100))
for (const m of K.METHOD_NAMES) {
  const cal = K.calibrateTruncation({ method: m, orbits: 2, sc })
  const rows = [50, 100, 200, 400, 800, 1600].map((n) => K.propagate({ sc, method: m, nPerOrbit: n, orbits: 2 }))
  const L = []
  for (let i = 1; i < 6; i++) {
    const a = rows[i - 1].relEnergyError, b = rows[i].relEnergyError
    L.push((Math.log(a / b) / Math.log(2)).toFixed(2))
  }
  console.log(m.padEnd(11) + String(K.METHODS[m].order).padEnd(9)
    + (cal.posPower.toFixed(3) + '/' + cal.metrics.pos.r2.toFixed(5)).padEnd(21)
    + (cal.eePower.toFixed(3) + '/' + cal.metrics.ee.r2.toFixed(5)).padEnd(21)
    + L.join('  '))
}

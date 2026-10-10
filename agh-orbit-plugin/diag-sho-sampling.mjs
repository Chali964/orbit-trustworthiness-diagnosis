import { __kernel as K } from './index.mjs'

const sc = K.makeScenario({ system: 'sho', amplitudeKm: 7000, periodSeconds: 5828.517 })
const NS = [50, 100, 200, 400, 800, 1600]

function powerAt(orbits) {
  const out = {}
  for (const m of ['rk4', 'heun', 'leapfrog', 'euler']) {
    const rows = NS.map((n) => K.propagate({ sc, method: m, nPerOrbit: n, orbits }))
    const p = []
    for (let i = 1; i < rows.length; i++) {
      p.push(Math.log(rows[i - 1].positionErrorKm / rows[i].positionErrorKm) / Math.log(2))
    }
    out[m] = p
  }
  return out
}

console.log('简谐振子：位置误差的逐段局部幂次，抽样时刻的影响')
console.log('（理论阶：rk4 = 4，heun = 2，leapfrog = 2，euler = 1）')
console.log('')
for (const orb of [2, 2.25, 2.3, 2.5, 3.3]) {
  const t = powerAt(orb)
  const w = 2 * Math.PI * orb               // 抽样相位的正弦绝对值，=0 表示落在折返点
  console.log(`弧段 orbits = ${String(orb).padEnd(5)}（相位 ${(w / Math.PI).toFixed(2)}π，|sin| = ${Math.abs(Math.sin(w)).toFixed(3)}）`)
  for (const m of Object.keys(t)) {
    console.log(`   ${m.padEnd(9)} 局部幂次 ${t[m].map((v) => v.toFixed(2)).join('  ')}`)
  }
  console.log('')
}

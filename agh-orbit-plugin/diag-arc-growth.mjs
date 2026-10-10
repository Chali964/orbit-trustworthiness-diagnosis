import { __kernel as K } from './index.mjs'

const sc = K.makeScenario({ system: 'sho', amplitudeKm: 7000, periodSeconds: 5828.517 })
const f = (v) => v.toExponential(3)

console.log('简谐振子：位置误差随弧段的增长（检验 R5 的 2× 弧段代理是否成立）')
console.log('')
for (const [m, n] of [['rk4', 50], ['heun', 800], ['leapfrog', 400]]) {
  console.log(`${m}  n=${n} 步/圈`)
  for (const orb of [6.3, 12.6, 25.2]) {
    const r = K.propagate({ sc, method: m, nPerOrbit: n, orbits: orb })
    console.log(`   ${String(orb).padStart(5)} 圈  位置误差 ${f(r.positionErrorKm)} km`)
  }
  const a = K.propagate({ sc, method: m, nPerOrbit: n, orbits: 6.3 }).positionErrorKm
  const b = K.propagate({ sc, method: m, nPerOrbit: n, orbits: 12.6 }).positionErrorKm
  console.log(`   2× 弧段比值 = ${(b / a).toFixed(3)}`)
  console.log('')
}

console.log('对比：二体问题 heun n=6000（同样被判漏报的那例）')
const tb = K.makeScenario({ system: 'twoBody' })
for (const orb of [6, 12, 24]) {
  const r = K.propagate({ sc: tb, method: 'heun', nPerOrbit: 6000, orbits: orb })
  console.log(`   ${String(orb).padStart(3)} 圈  位置误差 ${f(r.positionErrorKm)} km`)
}
const a2 = K.propagate({ sc: tb, method: 'heun', nPerOrbit: 6000, orbits: 6 }).positionErrorKm
const b2 = K.propagate({ sc: tb, method: 'heun', nPerOrbit: 6000, orbits: 12 }).positionErrorKm
console.log(`   2× 弧段比值 = ${(b2 / a2).toFixed(3)}`)

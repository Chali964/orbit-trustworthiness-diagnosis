/**
 * 报警规则冒烟测试：确认六条规则都能在真实的、有物理含义的场景下触发，
 * 并且「该触发的触发、不该触发的不触发」。
 * 运行：node agh-orbit-plugin/smoke-tools.mjs
 *
 * 场景设计（每个场景对应一类真实的误判风险）
 *   S1 辛积分器守恒极好但位置差      → 期望只触发 R1（不得误报 R3）
 *   S2 步长小到进入浮点平台          → 期望 R3（连带 R2/R5 也合理）
 *   S3 一阶方法步长偏大、两项都不达标 → 期望 R6（早期版本会漏报）
 *   S4 一阶方法步长极大              → 期望只触发 R4
 *   S5a/S5b 合理工程配置             → 期望一条都不触发
 */

import { __kernel } from './index.mjs'

const SCENARIOS = [
  { tag: 'S1', desc: '辛积分器：守恒量极好但位置超差（虚假安心）', expect: ['R1'], forbid: ['R3'], args: { method: 'leapfrog', nPerOrbit: 1600, orbits: 2, targetRelEnergyErr: 1e-10, targetPosErrKm: 0.1 } },
  { tag: 'S2', desc: 'RK4 步长小到进入浮点精度平台', expect: ['R3'], forbid: [], args: { method: 'rk4', nPerOrbit: 30000, orbits: 2, targetRelEnergyErr: 1e-13, targetPosErrKm: 1e-9 } },
  { tag: 'S3', desc: '前向欧拉，步长偏大，两项均不达标', expect: ['R6'], forbid: [], args: { method: 'euler', nPerOrbit: 2000, orbits: 2, targetRelEnergyErr: 1e-8, targetPosErrKm: 1 } },
  { tag: 'S4', desc: '前向欧拉，步长极大（应判发散）', expect: ['R4'], forbid: ['R2'], args: { method: 'euler', nPerOrbit: 8, orbits: 2, targetRelEnergyErr: 1e-6, targetPosErrKm: 10 } },
  { tag: 'S5a', desc: 'RK4 每圈 400 步（合理的工程配置）', expect: [], forbid: [], args: { method: 'rk4', nPerOrbit: 400, orbits: 2, targetRelEnergyErr: 1e-8, targetPosErrKm: 0.01 } },
  { tag: 'S5b', desc: '改进欧拉 每圈 2000 步（阈值放宽到它的能力范围）', expect: [], forbid: [], args: { method: 'heun', nPerOrbit: 2000, orbits: 2, targetRelEnergyErr: 1e-6, targetPosErrKm: 2 } },
]

console.log('='.repeat(96))
console.log('报警规则冒烟测试（六条规则 R1–R6，含误报/漏报检查）')
console.log('='.repeat(96))

const fired = new Set()
let bad = 0
for (const s of SCENARIOS) {
  const r = __kernel.alarmCheck(s.args)
  for (const k of r.triggeredRules) fired.add(k)
  const missing = s.expect.filter((k) => !r.triggeredRules.includes(k))
  const extra = s.forbid.filter((k) => r.triggeredRules.includes(k))
  const good = missing.length === 0 && extra.length === 0
  if (!good) bad++
  console.log('')
  console.log(`[${s.tag}] ${s.desc}   ${good ? '✓ 符合预期' : '✗ 不符合预期'}`)
  console.log(`     配置：${r.methodName}｜每圈 ${r.nPerOrbit} 步｜${r.orbits} 圈`)
  console.log(`     阈值：比能量 ≤ ${r.thresholds.targetRelEnergyErr.toExponential(0)}｜位置 ≤ ${r.thresholds.targetPosErrKm} km`)
  console.log(`     实测：位置 ${r.metrics.positionErrorKm.toExponential(3)} km｜比能量 ${r.metrics.relEnergyError.toExponential(3)}`
    + `｜实测阶 ${Number.isFinite(r.metrics.observedOrderPos) ? r.metrics.observedOrderPos.toFixed(3) : 'n/a'}（理论 ${r.metrics.theoreticalOrder}）`
    + `｜弧段增长 ${Number.isFinite(r.metrics.arcGrowthRatio) ? r.metrics.arcGrowthRatio.toFixed(2) + '×' : 'n/a'}`)
  const cell = (v) => (v === null || v === undefined ? '未测出（探针未达平台）' : v + ' 步/圈')
  console.log(`     下界口径：位置 ${cell(r.metrics.ceilingStepsPerOrbitPos)}｜比能量 ${cell(r.metrics.ceilingStepsPerOrbitEnergy)}`)
  console.log(`     判定：${r.summary}`)
  console.log(`     平台探针：${r.metrics.floorNote}`)
  if (missing.length) console.log(`     ! 期望触发但未触发：${missing.join('、')}`)
  if (extra.length) console.log(`     ! 不应触发却触发了：${extra.join('、')}`)
  for (const k of r.triggeredRules) {
    console.log(`       [${k}] ${r.ruleCatalog[k]}`)
    console.log(`            ${r.evidence[k]}`)
  }
}

console.log('')
console.log('-'.repeat(96))
const all = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']
console.log('覆盖检查：' + all.map((k) => `${k}=${fired.has(k) ? '已触发' : '未触发'}`).join('　'))
const missingRules = all.filter((k) => !fired.has(k))
console.log(`场景兼容性：${SCENARIOS.length - bad} / ${SCENARIOS.length} 符合预期`)
const pass = missingRules.length === 0 && bad === 0
console.log(pass
  ? '✓ 六条规则均验证可触发，且无误报/漏报。'
  : `! 未通过。未触发规则：${missingRules.join('、') || '无'}；不符预期场景数：${bad}`)
process.exit(pass ? 0 : 1)


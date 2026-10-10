/**
 * 误差预算字段验收测试
 * 验证 alarmCheck 新增的 errorBudget 字段在各配置下的行为。
 */
import { __kernel } from './index.mjs'

const cases = [
  { label: '截断主导（763 步/圈，目标 1e-5）', nPerOrbit: 763, targetPosErrKm: 1e-5 },
  { label: '浮点主导（6125 步/圈，目标 1e-5）', nPerOrbit: 6125, targetPosErrKm: 1e-5 },
  { label: '粗步长（200 步/圈）', nPerOrbit: 200, targetPosErrKm: 1e-5 },
]

let pass = 0
let fail = 0

for (const c of cases) {
  const r = __kernel.alarmCheck({
    method: 'rk4', nPerOrbit: c.nPerOrbit, orbits: 2,
    targetPosErrKm: c.targetPosErrKm, targetRelEnergyErr: 1e-10,
  })
  const b = r.errorBudget
  console.log('='.repeat(74))
  console.log(c.label)
  console.log('='.repeat(74))
  if (!b) {
    console.log('  errorBudget = null（发散或不可估）')
    continue
  }
  const chk = (cond, msg) => {
    if (cond) { pass++; console.log('    ✓ ' + msg) }
    else { fail++; console.log('    ✗ ' + msg) }
  }
  console.log(`  实测总误差      ${b.totalPositionErrorKm.toExponential(4)} km`)
  console.log(`  截断项          ${b.truncationKm?.toExponential(4)} km`)
  console.log(`  浮点地板        ${b.floatingFloorKm?.toExponential(4)} km`)
  console.log(`  浮点占比        ${b.floatingSharePct?.toFixed(3)} %`)
  console.log(`  瓶颈            ${b.bottleneck}`)
  if (b.stepsForOneOrderBetter) {
    console.log(`  提升一个量级需  ${b.stepsForOneOrderBetter} 步/圈 → 预计 ${b.predictedErrorKm?.toExponential(2)} km`)
  }
  console.log(`  建议            ${b.advice}`)
  console.log()
  chk(b.totalPositionErrorKm > 0, '总误差为正')
  chk(b.truncationKm >= 0, '截断项非负')
  chk(['truncation', 'floating'].includes(b.bottleneck), '瓶颈取值合法')
  chk(typeof b.advice === 'string' && b.advice.length > 10, '给出了改进建议')
  chk(Math.abs(Math.sqrt(b.truncationKm ** 2 + b.floatingFloorKm ** 2) - b.totalPositionErrorKm)
      / b.totalPositionErrorKm < 1e-9, '分解自洽：截断²+地板² = 总²')
  if (b.bottleneck === 'truncation') {
    chk(b.stepsForOneOrderBetter > c.nPerOrbit, '截断主导时给出了更大的步数')
    chk(b.floorLimited === false, '截断主导时 floorLimited = false')
  } else {
    chk(b.floorLimited === true, '浮点主导时 floorLimited = true')
  }
}

// ---------- 关键：误差预算必须出现在"模型实际看到的文本"里 ----------
// 只写进 structured 是不够的 —— 工具的 content 才是模型读到的内容。
console.log('='.repeat(74))
console.log('content（模型可见文本）检查')
console.log('='.repeat(74))
{
  const tool = __kernel.TOOLS.find((t) => t.name === 'orbit_alarm_check')
  const chk = (cond, msg) => {
    if (cond) { pass++; console.log('    ✓ ' + msg) }
    else { fail++; console.log('    ✗ ' + msg) }
  }
  chk(!!tool, 'orbit_alarm_check 工具存在')
  if (tool) {
    const r = await tool.execute({
      method: 'rk4', nPerOrbit: 763, orbits: 2,
      targetPosErrKm: 1e-5, targetRelEnergyErr: 1e-10,
    })
    const text = r.content[0].text
    console.log('  --- 模型读到的文本 ---')
    for (const l of text.split('\n')) console.log('    ' + l)
    console.log()
    chk(text.includes('误差预算'), 'content 含「误差预算」')
    chk(text.includes('改进方向'), 'content 含「改进方向」')
    chk(text.includes('瓶颈'), 'content 含「瓶颈」判定')
    chk(text.includes('1309'), 'content 含反推的具体步数（1309）')
    chk('errorBudget' in r.structured, 'structured 仍保留完整 errorBudget')
    chk(text.includes('R5'), '原有告警信息未被破坏')
  }
}

console.log('='.repeat(74))
console.log(`验收：通过 ${pass} 项，未通过 ${fail} 项`)
console.log('='.repeat(74))
process.exit(fail === 0 ? 0 : 1)

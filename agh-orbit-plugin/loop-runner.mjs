/**
 * 四步闭环编排（可直接运行）
 * ============================================================================
 * 目的
 *   把「任务规划 → 能力调用 → 反馈处理 → 结果验证」四个步骤编排成一条真正
 *   闭合的链路，并证明：
 *     ① 链路连续经过 ≥3 个 AGH 工具调用（满足赛事「经 AGH 完成 ≥3 个连续步骤」）
 *     ② 存在真实回环：验证不通过时回到第二步换方法，而不是一路走到底
 *     ③ 每步的输入、处理逻辑、输出、衔接关系都可复现、可核对
 *
 * 关键设计（每一步都有工程理由，不是摆设）
 *   第二步起步步长用「守恒量口径」标定——因为守恒量误差的收敛幂次稳定为 5.000
 *   且反算偏差 ≤0.6%，标定最可靠。
 *   第三步收敛判据用「位置口径」——因为位置才是交付指标。
 *   两个口径混用正是 R1 报警要抓的错。本编排刻意让第三步去发现并纠正它。
 *
 * 运行：node agh-orbit-plugin/loop-runner.mjs
 */

import { __kernel } from './index.mjs'

const TOOLS = Object.fromEntries(__kernel.TOOLS.map((t) => [t.name, t]))

const trace = []
let callCounter = 0
async function call(name, args, note) {
  callCounter++
  const idx = callCounter
  const t = TOOLS[name]
  if (!t) throw new Error(`未注册的工具：${name}`)
  const t0 = Date.now()
  const res = await t.execute(args)
  const ms = Date.now() - t0
  trace.push({ idx, tool: name, args, ms, summary: res.content[0].text.split('\n')[0] })
  console.log(`   [调用 ${String(idx).padStart(2)}] ${name}（${ms} ms）`)
  if (note) console.log(`              ${note}`)
  return res.structured
}

const f = (v, d = 3) => (v === null || v === undefined ? '未测出' : Number(v).toExponential(d))
const bar = (c = '-') => console.log(c.repeat(94))

// ============================================================================
// 第一步：任务规划
// ============================================================================
async function step1_plan(goal) {
  console.log('')
  bar('=')
  console.log('第一步　任务规划')
  bar()
  console.log(`  交付目标：a = ${goal.semiMajorAxisKm ?? __kernel.A_SEMI} km，`
    + `e = ${goal.eccentricity ?? __kernel.ECC}，积分 ${goal.orbits} 圈`)
  console.log(`            位置误差 ≤ ${goal.targetPosErrKm} km；比能量相对误差 ≤ ${goal.targetRelEnergyErr.toExponential(0)}`)

  const info = await call('orbit_kernel_info', {
    semiMajorAxisKm: goal.semiMajorAxisKm, eccentricity: goal.eccentricity,
  }, '取场景量、可选积分器、标定式与报警规则目录')

  const spec = {
    ...goal,
    scenario: info.scenario,
    period_s: info.scenario.period_s,
    machineEpsilon: info.machineEpsilon,
    thresholds: { posErrKm: goal.targetPosErrKm, relEnergyErr: goal.targetRelEnergyErr },
  }
  console.log('  处理逻辑：把交付目标翻译成「阈值对」，并选定判定链路')
  console.log('  输出：验证任务书')
  console.log(`        · 场景：a = ${spec.scenario.semiMajorAxis_km} km，e = ${spec.scenario.eccentricity}`
    + `，近地点 ${spec.scenario.rPeriapsis_km.toFixed(0)} km，远地点 ${spec.scenario.rApoapsis_km.toFixed(0)} km`)
  console.log(`        · 周期 T = ${spec.period_s.toFixed(3)} s｜发散判据 ${spec.scenario.divergenceLimit_km.toFixed(0)} km`
    + `｜机器精度 ε = ${spec.machineEpsilon.toExponential(4)}`)
  console.log(`        · 阈值对：位置 ≤ ${spec.thresholds.posErrKm} km ｜ 比能量 ≤ ${spec.thresholds.relEnergyErr.toExponential(0)}`)
  console.log(`        · 候选方法：${goal.candidates.join(' / ')}`)
  console.log('  衔接：阈值对与候选方法交给第二步作为搜索目标')
  return spec
}

// ============================================================================
// 第二步：能力调用
// ============================================================================
async function step2_execute(spec) {
  console.log('')
  bar('=')
  console.log('第二步　能力调用')
  bar()
  console.log(`  输入：第一步的阈值对 + ${spec.candidates.length} 个候选方法`)

  const scored = []
  for (const method of spec.candidates) {
    const cal = await call('orbit_calibrate_step', {
      method, orbits: spec.orbits,
      targetRelEnergyErr: spec.thresholds.relEnergyErr,
      targetPosErrKm: spec.thresholds.posErrKm,
      semiMajorAxisKm: spec.semiMajorAxisKm, eccentricity: spec.eccentricity,
    })
    const needPos = cal.requiredStepsPerOrbitPos
    const needEe = cal.requiredStepsPerOrbit
    // 同时满足两个口径所需的步数：这才是真正的「起步条件」
    const needBoth = Math.max(needPos ?? 0, needEe ?? 0)
    // 下界上限：测出就用测出的；没测出说明探针步长下误差仍在改善，
    // 即真实上限不低于探针步数，保守取探针步数（不得据此淘汰方法）
    const ceilingMeasured = cal.ceilingStepsPerOrbitPos
    const ceilingEffective = ceilingMeasured === null ? cal.probeStepsPerOrbit : ceilingMeasured
    const ceilingFloorLimited = ceilingMeasured === null
    // 可行性是三态，不能只有「可行/不可行」：
    //   yes     —— 位置口径标定可靠，且所需步数不超过下界上限
    //   no      —— 位置口径标定可靠，但所需步数已超下界上限（该目标低于此方法的能力上限）
    //   unknown —— 位置口径标定不可靠（该场景下误差不服从幂律），无法预测所需步数。
    //              此时**不能判为不可行**——没有预测能力不等于做不到，应交给第三步实跑迭代去试。
    //              实测背景：大偏心率轨道（如 a=12000, e=0.45）上，误差由近地点通过处主导，
    //              位置误差随步长不再是干净幂律，四个方法的标定全部不可靠。
    const needPosKnown = needPos !== null && needPos !== undefined
    const verdict = needPosKnown ? (needPos <= ceilingEffective ? 'yes' : 'no') : 'unknown'
    const feasible = verdict !== 'no'
    scored.push({
      method, cal, needEe, needPos, needBoth, ceilingMeasured, ceilingEffective,
      ceilingFloorLimited, verdict, feasible, feasibilityUnknown: verdict === 'unknown',
    })
    const showNeed = (v) => (v === null || v === undefined ? '不可预测' : `${v} 步`)
    console.log(`              → 位置口径需 ${showNeed(needPos).padStart(9)}`
      + `｜守恒量口径 ${showNeed(needEe).padStart(9)}`
      + `｜起步取 ${String(needBoth).padStart(9)} 步`
      + `｜位置下界上限 ${ceilingFloorLimited ? `≥${ceilingEffective}（保守）` : ceilingEffective}`
      + ` → ${verdict === 'yes' ? '可行' : verdict === 'unknown' ? '不可预测（转实跑迭代）' : '不可行'}`)
  }

  const feasible = scored.filter((s) => s.feasible)
  const unknownCount = feasible.filter((s) => s.feasibilityUnknown).length
  console.log('  处理逻辑：逐个方法标定步长，判据为三态——')
  console.log('            ① 位置口径标定可靠且所需步数 ≤ 下界上限 → 可行')
  console.log('            ② 位置口径标定可靠但所需步数已超上限   → 不可行（目标低于该方法的能力上限）')
  console.log('            ③ 位置口径标定不可靠（误差非幂律）     → 不可预测，转第三步实跑迭代')
  console.log('            下界上限若未测出，说明探针步长下误差仍在改善，真实上限不低于探针步数，')
  console.log('            故保守取探针步数——这只影响数值不淘汰方法。')
  console.log(`  输出：可进入下一步 ${feasible.length} 个 / 候选 ${scored.length} 个`
    + (unknownCount ? `（其中 ${unknownCount} 个属「不可预测」，需靠实跑迭代定步长）` : ''))
  for (const s of feasible) {
    if (s.feasibilityUnknown) {
      console.log(`        · ${s.method}：标定不可预测（位置口径 ${s.cal.reliability.position.reasons[0] || '不可靠'}），`
        + `改由第三步实跑迭代定步长`)
    } else {
      console.log(`        · ${s.method}：起步每圈 ${s.needBoth} 步（同时满足两口径），`
        + `位置口径可用区间 [${s.needPos}, ${s.ceilingEffective}]`)
    }
  }
  for (const s of scored.filter((x) => !x.feasible)) {
    console.log(`        · ${s.method}：剔除 —— 位置口径需 ${s.needPos} 步 > 下界上限 ${s.ceilingEffective} 步，`
      + `即该目标低于此方法可达的最好水平（${f(s.cal.floorPosErrorRawProbe)} km）`)
  }
  console.log('  衔接：把「方法 + 起步步长」交给第三步实际递推；不可行方法直接出局')
  return { spec, scored, feasible }
}

// ============================================================================
// 第三步：反馈处理（含真实回环）
// ============================================================================
async function step3_feedback(spec, cand) {
  console.log('')
  bar('=')
  console.log('第三步　反馈处理')
  bar()
  // 起步步长优先用守恒量口径（幂次稳定、反算偏差小）；
  // 若该方法守恒量口径标定不可靠（如辛积分器），退回位置口径起步；
  // 若两个口径都不可预测（大偏心率场景），用一个启发式起点，完全交给迭代去收敛。
  const HEURISTIC_START = 500
  let startMetric, nStart
  if (cand.needEe !== null && cand.needEe !== undefined) {
    startMetric = '能量口径'; nStart = cand.needEe
  } else if (cand.needPos !== null && cand.needPos !== undefined) {
    startMetric = '位置口径'; nStart = cand.needPos
  } else {
    startMetric = '启发式起点'; nStart = HEURISTIC_START
  }
  console.log(`  输入：第二步给出的「方法 = ${cand.method}，起步每圈 ${nStart} 步（${startMetric}）」`)
  if (startMetric === '能量口径') {
    console.log('        为什么起步信守恒量口径而不是直接用「两口径取大」：')
    console.log('          守恒量口径幂次稳定、反算偏差小，反推步数可靠；')
    console.log('          位置口径幂次会随步长漂移，反推步数可靠性低。')
    console.log('        于是「先信可靠标定、再用交付指标实测修正」，这也正是 R1 要抓的错被自动纠正的过程。')
  } else if (startMetric === '位置口径') {
    console.log('        注意：该方法的守恒量误差不服从幂律（标定不可靠），故退回位置口径起步。')
  } else {
    console.log(`        注意：该场景下两个口径的标定都不可预测（误差不服从干净幂律），`)
    console.log(`              故从启发式起点 ${HEURISTIC_START} 步起步，完全由迭代按实测结果收敛。`)
    console.log('              这正是「标定不可用时不返回数字、改由实跑迭代兜底」的设计意图。')
  }

  const iter = []
  let n = Math.max(2, Math.round(nStart))
  let last = null
  let converged = false
  const MAX_ITER = 4

  for (let k = 0; k < MAX_ITER; k++) {
    last = await call('orbit_propagate', {
      method: cand.method, nPerOrbit: n, orbits: spec.orbits,
      semiMajorAxisKm: spec.semiMajorAxisKm, eccentricity: spec.eccentricity,
    })
    const posOk = last.positionErrorKm <= spec.thresholds.posErrKm
    const eeOk = last.relEnergyError <= spec.thresholds.relEnergyErr
    iter.push({ n, pos: last.positionErrorKm, relE: last.relEnergyError, posOk, eeOk })
    console.log(`              第 ${k + 1} 次：位置 ${f(last.positionErrorKm)} km（${posOk ? '达标' : '超差'}）`
      + `｜比能量 ${f(last.relEnergyError)}（${eeOk ? '达标' : '超差'}）`)
    if (posOk && eeOk) { converged = true; break }
    // 按阶数缩步：n_new = n · (err/target)^(1/p)
    // 缩放指数优先用「标定实测幂次」——它比理论阶更准（RK4 位置口径实测 4.267 而非 4）；
    // 该口径标定不可靠时才回退到理论阶，并在日志里写明来源。
    // 目标线打 0.9 折作为内缩目标：幂律只是近似关系（实测幂次会随步长漂移，
    // 位置口径从 4.55 漂到 4.07），贴着目标线收敛会因模型误差反复微调。
    const SCALE_SAFETY = 0.9
    const target = posOk ? spec.thresholds.relEnergyErr : spec.thresholds.posErrKm
    const err = posOk ? last.relEnergyError : last.positionErrorKm
    const metricRel = posOk ? cand.cal.reliability.energy : cand.cal.reliability.position
    const p = metricRel.reliable ? metricRel.power
      : (posOk ? last.theoreticalOrder + 1 : last.theoreticalOrder)
    const pSource = metricRel.reliable ? '标定实测幂次' : '理论阶（标定不可用，已回退）'
    const aim = target * SCALE_SAFETY
    const nNext = Math.ceil(n * Math.pow(err / aim, 1 / p))
    if (nNext <= n || nNext > 5e6) {
      console.log(`              按阶数缩放无进展（下一档 ${nNext} 步），跳出迭代`)
      break
    }
    console.log(`              未全部达标 → 按阶数缩放：n' = n·(err/内缩目标)^(1/p) = ${n}·(${f(err)}/${f(aim)})^(1/${p.toFixed(3)}) = ${nNext} 步　[p 来源：${pSource}]`)
    n = nNext
  }

  const note = iter.length > 1
    ? (startMetric === '启发式起点'
      ? `标定不可预测，从启发式起点实跑迭代 ${iter.length} 次后${converged ? '收敛' : '仍未收敛'}`
      : `起步步长按${startMetric}标定，位置口径超差，迭代 ${iter.length} 次后${converged ? '收敛' : '仍未收敛'}`)
    : '起步即全部达标'
  console.log(`  处理逻辑：用位置口径复核；未达标时按实测阶数缩放步长并重跑，最多 ${MAX_ITER} 次`)
  console.log(`  输出：${note}`)
  console.log('  衔接：收敛则把「方法 + 最终步长」交给第四步做严格验证；')
  console.log('        未收敛则回到第二步换下一个可行方法（这就是闭环的回路）')
  return { method: cand.method, nFinal: n, converged, iter, last, note }
}

// ============================================================================
// 第四步：结果验证
// ============================================================================
async function step4_verify(spec, fb) {
  console.log('')
  bar('=')
  console.log('第四步　结果验证')
  bar()
  console.log(`  输入：第三步收敛配置「${fb.method}｜每圈 ${fb.nFinal} 步」`)

  const ladder = [Math.max(2, Math.round(fb.nFinal / 4)), Math.max(3, Math.round(fb.nFinal / 2)),
    fb.nFinal, fb.nFinal * 2].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b)
  const od = await call('orbit_order_test', {
    method: fb.method, orbits: spec.orbits, nList: ladder,
    semiMajorAxisKm: spec.semiMajorAxisKm, eccentricity: spec.eccentricity,
  }, `观察阶测试阶梯：${ladder.join(' / ')} 步每圈`)
  console.log(`              → 理论阶 ${od.theoreticalOrder}，拟合实测阶 ${od.fittedOrderPos.toFixed(3)}（比值 ${od.orderRatio.toFixed(2)}）`)

  const al = await call('orbit_alarm_check', {
    method: fb.method, nPerOrbit: fb.nFinal, orbits: spec.orbits,
    targetRelEnergyErr: spec.thresholds.relEnergyErr, targetPosErrKm: spec.thresholds.posErrKm,
    semiMajorAxisKm: spec.semiMajorAxisKm, eccentricity: spec.eccentricity,
  }, '六规则体检')
  console.log(`              → ${al.summary}`)
  for (const k of al.triggeredRules) console.log(`                [${k}] ${al.evidence[k]}`)

  const orderOk = od.orderRatio > 0.85
  // 只有「致命级」报警才阻断交付（R1 守恒量与位置矛盾 / R4 发散 / R6 两项都不达标）。
  // R2 / R3 / R5 是警告级：它们说明数值过程有问题或结论适用范围受限，但结果本身仍可用。
  // 早期版本把所有报警都当成不通过，结果因为一条 R5 警告否定了一个各项指标都合格的配置。
  const blocking = al.blockingRules || []
  const warnings = al.warningRules || []
  const pass = orderOk && blocking.length === 0 && fb.converged

  console.log('  处理逻辑：用第 5 级严格度的观察阶测试核对实现是否符合理论阶；')
  console.log('            再用六规则体检抓「数值合格但结论不可信」的情形。')
  console.log('            其中只有致命级（R1/R4/R6）阻断交付；R2/R3/R5 为警告级，需报告但不阻断。')
  console.log(`  输出：实测阶 ${od.fittedOrderPos.toFixed(3)}（${orderOk ? '符合' : '不符'}理论阶）；`
    + `致命报警 ${blocking.length} 条${blocking.length ? '（' + blocking.join('、') + '）' : ''}，`
    + `警告 ${warnings.length} 条${warnings.length ? '（' + warnings.join('、') + '）' : ''}`)
  console.log(`  判定：${pass ? '✓ 可信' : '✗ 不可信'}${warnings.length && pass ? '（带警告：结果可用，但需说明适用范围限制）' : ''}`)
  console.log('  衔接：通过 → 输出可信度报告并结束；不通过 → 回到第二步换方法重跑')
  return { pass, od, al, ladder, orderOk, blocking, warnings }
}

// ============================================================================
// 主流程：四步闭环 + 回环
// ============================================================================
async function runGoal(goal, label) {
  console.log('')
  console.log('#'.repeat(94))
  console.log(`# ${label}`)
  console.log('#'.repeat(94))
  callCounter = 0
  const rounds = []

  // 场景参数若非法（例如 e ≥ 1 不是椭圆轨道），应在第一步就明确拒绝，
  // 而不是带着错参数一路算到底。这里把拒绝也当作一种正确的闭环结果记录下来。
  let spec
  try {
    spec = await step1_plan(goal)
  } catch (err) {
    console.log('')
    console.log('>> 第一步即拒绝该场景，闭环在「参数合法性」处终止（未进入后续步骤）')
    console.log(`   原因：${err.message}`)
    return {
      spec: null, rounds: [], final: null, ok: false, calls: callCounter,
      rejected: err.message,
    }
  }

  let ex = await step2_execute(spec)
  let round = 0

  while (round < 2 && ex.feasible.length > 0) {
    round++
    // 取同时满足两口径所需步数最少的方法，但优先选「标定可靠」的：
    // 不可预测的方法排在后（它们要靠更多次实跑迭代摸索，代价更高）
    const cand = [...ex.feasible].sort((a, b) => {
      if (a.feasibilityUnknown !== b.feasibilityUnknown) return a.feasibilityUnknown ? 1 : -1
      return a.needBoth - b.needBoth
    })[0]
    console.log('')
    console.log(`>> 第 ${round} 轮回环：选用 ${cand.method}`)
    const fb = await step3_feedback(spec, cand)
    const vr = await step4_verify(spec, fb)
    rounds.push({ round, method: cand.method, nFinal: fb.nFinal, fb, vr })
    if (vr.pass) {
      console.log('')
      console.log(`>> 第 ${round} 轮通过，闭环结束`)
      return { spec, rounds, final: rounds[rounds.length - 1], ok: true, calls: callCounter }
    }
    // 回环：剔除本轮方法，回到第二步
    ex = { ...ex, feasible: ex.feasible.filter((x) => x.method !== cand.method) }
    console.log('')
    console.log(`>> 第 ${round} 轮未通过 → 回环到第二步：剔除 ${cand.method}，剩余可行方法 ${ex.feasible.map((x) => x.method).join('、') || '无'}`)
  }

  const last = rounds.length ? rounds[rounds.length - 1] : null
  console.log('')
  if (!last) {
    console.log('>> 第二步即判全部候选不可行，闭环在「能力边界」处终止（未进入第三、四步）')
    const detail = ex.scored.map((s) => `   · ${s.method}：位置目标需 ${s.needPos} 步，超下界上限 ${s.ceilingEffective} 步`
      + `（该方法位置误差的精度平台约 ${f(s.cal.floorPosErrorRawProbe)} km）`).join('\n')
    console.log(detail)
  } else {
    console.log('>> 无可再回环的方法，闭环以「不可信」结束')
  }
  return { spec, rounds, final: last, ok: false, calls: callCounter }
}

// ---- 四个目标：覆盖「正常闭环 / 能力边界 / 换轨道尺度 / 换轨道形状」 ----
const GOAL_A = {
  orbits: 2,
  targetPosErrKm: 1e-5,
  targetRelEnergyErr: 1e-10,
  candidates: ['rk4', 'leapfrog', 'midpoint', 'heun'],
}
const GOAL_B = {
  orbits: 2,
  targetPosErrKm: 1e-9,
  targetRelEnergyErr: 1e-13,
  candidates: ['rk4', 'leapfrog'],
}
// 迁移验证一：地球同步轨道（a 放大 6 倍、近圆）。检验标定与步长是否随轨道尺度正确变化。
const GOAL_C = {
  semiMajorAxisKm: 42164,
  eccentricity: 0.0001,
  orbits: 2,
  targetPosErrKm: 1,
  targetRelEnergyErr: 1e-10,
  candidates: ['rk4', 'leapfrog', 'midpoint', 'heun'],
}
// 迁移验证二：大偏心率椭圆（a 放大到 12000 km、e=0.45）。检验发散判据与标定在形状变化下是否仍成立。
//   e 原为 0.6 —— 但该参数下近地点 4800 km 低于地球半径，轨道在地球内部。
//   0.45 是 a=12000 时物理成立的最大偏心率（近地点 6600 km，高度 229 km），且更严苛。
const GOAL_D = {
  semiMajorAxisKm: 12000,
  eccentricity: 0.45,
  orbits: 2,
  targetPosErrKm: 1,
  targetRelEnergyErr: 1e-10,
  candidates: ['rk4', 'leapfrog', 'midpoint', 'heun'],
}
// 迁移验证三：非法参数应被明确拒绝（e ≥ 1 不是椭圆轨道）
const GOAL_E = {
  semiMajorAxisKm: 12000,
  eccentricity: 1.4,
  orbits: 2,
  targetPosErrKm: 1,
  targetRelEnergyErr: 1e-10,
  candidates: ['rk4'],
}

const rA = await runGoal(GOAL_A, '目标 A：默认场景（a=7000, e=0.05）位置 ≤ 1e-5 km、比能量 ≤ 1e-10')
const rB = await runGoal(GOAL_B, '目标 B：默认场景、严苛目标（考验方法能力边界）')
const rC = await runGoal(GOAL_C, '目标 C【迁移】：地球同步轨道 a=42164 km、e≈0（换轨道尺度）')
const rD = await runGoal(GOAL_D, '目标 D【迁移】：大偏心率椭圆 a=12000 km、e=0.45（换轨道形状）')
const rE = await runGoal(GOAL_E, '目标 E【边界】：非法参数 e=1.4（应被明确拒绝）')

// ============================================================================
// 汇总
// ============================================================================
console.log('')
console.log('#'.repeat(94))
console.log('# 闭环汇总')
console.log('#'.repeat(94))
bar('=')
console.log(`${'目标'.padEnd(9)}${'轨道场景'.padEnd(24)}${'轮'.padEnd(5)}${'最终方法'.padEnd(11)}${'最终步数'.padEnd(10)}${'实测阶'.padEnd(9)}${'致命/警告'.padEnd(11)}判定`)
bar()
const ALL = [['目标 A', rA], ['目标 B', rB], ['目标 C', rC], ['目标 D', rD], ['目标 E', rE]]
for (const [name, r] of ALL) {
  const last = r.rounds.length ? r.rounds[r.rounds.length - 1] : null
  const scen = r.spec
    ? `a=${r.spec.scenario.semiMajorAxis_km} e=${r.spec.scenario.eccentricity}`
    : `a=${r.rejected ? '非法' : '—'}`
  let verdict
  if (r.rejected) verdict = '✗ 参数被拒绝（正确行为）'
  else if (r.ok) verdict = '✓ 可信'
  else if (r.rounds.length) verdict = '✗ 不可信'
  else verdict = '✗ 不可行（能力边界）'
  console.log(`${name.padEnd(9)}${scen.padEnd(24)}${String(r.rounds.length).padEnd(5)}`
    + `${(last ? last.method : '—').padEnd(11)}`
    + `${String(last ? last.fb.nFinal : '—').padEnd(10)}`
    + `${(last ? last.vr.od.fittedOrderPos.toFixed(3) : '—').padEnd(9)}`
    + `${(last ? `${last.vr.blocking.length}/${last.vr.warnings.length}` : '—').padEnd(11)}${verdict}`)
}
bar()

console.log('')
console.log('迁移验证：换轨道尺度 / 换轨道形状后，标定与结论是否仍成立')
console.log(`${'指标'.padEnd(24)}${'目标 A（默认）'.padEnd(20)}${'目标 C（GEO）'.padEnd(20)}${'目标 D（大偏心率）'}`)
console.log('-'.repeat(96))
const rowOf = (r, fn) => (r.spec ? fn(r.spec) : '—')
const cells = (fn) => [rowOf(rA, fn), rowOf(rC, fn), rowOf(rD, fn)]
const rowsMigration = [
  ['半长轴 a (km)', (s) => String(s.scenario.semiMajorAxis_km)],
  ['偏心率 e', (s) => String(s.scenario.eccentricity)],
  ['周期 T (s)', (s) => s.period_s.toFixed(1)],
  ['发散判据 (km)', (s) => s.scenario.divergenceLimit_km.toFixed(0)],
  ['最终方法', (s) => '—'],
  ['最终每圈步数', (s) => '—'],
]
for (const [k, fn] of rowsMigration) {
  if (k === '最终方法' || k === '最终每圈步数') continue
  console.log(`${k.padEnd(24)}` + cells(fn).map((v) => String(v).padEnd(20)).join(''))
}
const finalOf = (r) => (r.rounds.length ? `${r.rounds[r.rounds.length - 1].method} / ${r.rounds[r.rounds.length - 1].fb.nFinal} 步` : '—')
console.log(`${'最终配置'.padEnd(24)}${finalOf(rA).padEnd(20)}${finalOf(rC).padEnd(20)}${finalOf(rD)}`)
console.log('-'.repeat(96))
console.log('读法：三个场景的 a、e、T、发散判据都不同，闭环各自独立标定、独立收敛，')
console.log('      说明内核不是只会算一条轨道 —— 标定与判据都随场景重算。')

console.log('')
console.log('链路连续性核对（这是「经 AGH 完成 ≥3 个连续步骤」的证据）')
const allToolNames = Object.keys(TOOLS)
console.log(`  已注册工具入口：${allToolNames.join('、')}`)
for (const [name, r] of ALL) {
  console.log(`  ${name} 全程发生 ${String(r.calls).padStart(2)} 次工具调用；回环轨迹：`
    + (r.rounds.length
      ? r.rounds.map((x) => `第${x.round}轮（${x.method}，${x.vr.pass ? '通过' : '未通过'}）`).join(' → ')
      : (r.rejected ? '第一步即拒绝（参数非法）' : '第二步即终止（无可行的候选方法）')))
}
console.log(`  单轮内的连续调用链：orbit_kernel_info → orbit_calibrate_step → orbit_propagate（可迭代 1–4 次）`
  + ` → orbit_order_test → orbit_alarm_check，共 5 类工具、≥5 个连续步骤`)

console.log('')
const migrated = [rC, rD].filter((r) => r.ok).length
console.log('闭环判定：'
  + (rA.ok ? '目标 A 走通完整四步并回环收敛' : '目标 A 未通过')
  + '；' + (rB.ok ? '目标 B 亦通过' : '目标 B 以「不可行」正确终止')
  + `；迁移场景 ${migrated}/2 通过（GEO 与大偏心率各一）`
  + '；' + (rE.rejected ? '目标 E 的非法参数被正确拒绝' : '目标 E 未被拒绝（异常）'))
const overallOk = rA.ok && migrated === 2 && !!rE.rejected
process.exit(overallOk ? 0 : 1)

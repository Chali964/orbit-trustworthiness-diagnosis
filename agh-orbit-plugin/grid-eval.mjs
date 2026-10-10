/**
 * 报警器误报率 / 漏报率网格统计（多场景版）
 * ============================================================================
 * 目的
 *   把 smoke-tools.mjs 的「6 个场景符合预期」升级为统计数字：在方法 × 步长 × 弧段
 *   的网格上，逐条统计每条规则的真阳性 / 假阳性 / 假阴性，并<b>跨三个轨道场景</b>验证
 *   规则是否仍然成立。
 *
 * 核心设计：规则是「廉价代理」，真值是「更贵更可靠的判据」
 *   如果用规则自己的判据当真值，统计只是自证。所以每条规则都配一个「算法相同、
 *   但取样更多、代价更高」的真值判据。统计的正是「用廉价代理换省算力」的代价：
 *
 *   ┌ 合格性类（R1 / R4 / R6 的并集）
 *   │   真值：配置「不合格」当且仅当 位置误差超阈值 或 递推发散。
 *   │   另外检查规则集合的内部一致性：R1 与 R6 必须互斥，R4 必须独占。
 *   ├ R2：规则用四点阶梯 (n/2…4n) → 真值用六点阶梯 (n/4…8n)
 *   ├ R3：规则用标定上限 或 细分 8 倍 → 真值用细分 16 倍
 *   └ R5：规则用 2× 弧段 → 真值用 4× 弧段
 *
 * 三场景的阈值换算
 *   位置阈值按轨道尺度等比缩放：posTol = 1 km × (a / 7000)。
 *   理由：相对精度才是尺度无关的量；固定 1 km 对 GEO 会宽松 6 倍、对不同 a 不可比。
 *   比能量阈值是无量纲量（相对误差），三场景统一取 1e-10。
 *
 * 运行：node agh-orbit-plugin/grid-eval.mjs
 *   退出码始终为 0（这是统计工具，不是断言工具）；
 *   结果写入 out/grid-eval.txt 与 out/grid-eval.csv
 */

import { __kernel as K } from './index.mjs'
import { cpUpper } from './confidence.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')
mkdirSync(outDir, { recursive: true })

// ---------------- 场景 ----------------
// arcs 是积分弧段（单位：周期）。前三个二体场景用 [1, 6]，与既有基线一致。
// 简谐振子要避开整周期 —— 抽样若落在折返点，一阶相位误差被零导数掩盖，
// 测出的收敛阶会被抬高（见 diag-sho-sampling.mjs 的实测）。故用 [1.3, 6.3]。
// 另外单独加一个「整周期·折返点」的简谐振子场景，用来量化这个陷阱的代价。
const SCENARIOS = [
  { key: 'leo', label: '默认 LEO', system: 'twoBody', semiMajorAxisKm: 7000, eccentricity: 0.05, scaleKm: 7000, arcs: [1, 6] },
  { key: 'geo', label: 'GEO（近圆）', system: 'twoBody', semiMajorAxisKm: 42164, eccentricity: 0.0001, scaleKm: 42164, arcs: [1, 6] },
  // e 由 0.6 改为 0.45：原参数近地点 4800 km，低于地球半径 6371 km，轨道在地球内部、无物理意义。
  // 改为 0.45 后近地点 6600 km（高度仅 229 km），仍是「大偏心率 + 低近地点」的严苛工况。
  { key: 'ecc', label: '大偏心率', system: 'twoBody', semiMajorAxisKm: 12000, eccentricity: 0.45, scaleKm: 12000, arcs: [1, 6] },
  // 极端偏心率：检验规则在「近地点极低、速度变化极剧烈」时是否仍准确。
  // a=70000 / e=0.9 → 近地点地心距 7000 km（高度 629 km，在地表以上，物理成立），
  // 远地点 133000 km，周期约 2.13 天；近地点速度约 10.4 km/s（LEO 仅 7.7 km/s）——
  // 这是本网格中数值上最严苛的工况，用来界定「规则在多大偏心率范围内仍可用」。
  { key: 'ecc9', label: '极端偏心率', system: 'twoBody', semiMajorAxisKm: 70000, eccentricity: 0.9, scaleKm: 70000, arcs: [1, 6] },
  { key: 'sho', label: '简谐振子', system: 'sho', amplitudeKm: 7000, periodSeconds: 5828.517, scaleKm: 7000, arcs: [1.3, 6.3] },
  {
    key: 'shoTP', label: '简谐振子(折返点)', system: 'sho',
    amplitudeKm: 7000, periodSeconds: 5828.517, scaleKm: 7000, arcs: [1, 6],
  },
]

// ---------------- 网格与阈值 ----------------
const METHODS = K.METHOD_NAMES
const N_LIST = [50, 100, 200, 400, 800, 2000, 6000, 20000]
// 弧段（单位：周期）已移入每个场景的 arcs 字段 —— 简谐振子必须避开整周期折返点，
// 不能与二体场景共用同一组弧段。
const DEFAULT_ARCS = [1, 6]
const BASE_POS_TOL_KM = 1.0
const ENERGY_TOL = 1e-10

// 单项计算的步数上限（防止个别单元把总时长拖爆；超限的检查记为 N/A）
const MAX_STEPS_PER_RUN = 3.0e6
let stepsUsed = 0
let skippedByBudget = 0

/** 幂次拟合：v ∝ x^(−power)，返回 power */
function fitSlope(xs, ys) {
  const lx = xs.map(Math.log), ly = ys.map(Math.log)
  const m = lx.length
  const mx = lx.reduce((a, b) => a + b, 0) / m
  const my = ly.reduce((a, b) => a + b, 0) / m
  let sxx = 0, sxy = 0
  for (let i = 0; i < m; i++) { sxx += (lx[i] - mx) ** 2; sxy += (lx[i] - mx) * (ly[i] - my) }
  return -sxy / sxx
}

function emptyStat(label, how) {
  return { label, how, tp: 0, fp: 0, fn: 0, tn: 0, na: 0, cases: [] }
}
function newStats() {
  return {
    eligibility: emptyStat('R1∪R4∪R6（合格性）', '位置超阈值 或 递推发散（纯数值事实）'),
    R2: emptyStat('R2（观测阶偏低）', '六点阶梯 (n/4…8n) 全局幂次 < 理论阶 × 0.6'),
    R3: emptyStat('R3（步长小于有效下界）', '细分 16 倍后位置误差改善仍 < 2 倍'),
    R5: emptyStat('R5（弧段外推失效）', '当前弧段末态合格，且 4× 弧段内最大误差已超阈值'),
  }
}
function tally(stat, predicted, truth, detail) {
  if (truth === null || truth === undefined) { stat.na++; return }
  if (truth && predicted) stat.tp++
  else if (!truth && predicted) { stat.fp++; stat.cases.push({ type: '假阳性', ...detail }) }
  else if (truth && !predicted) { stat.fn++; stat.cases.push({ type: '假阴性', ...detail }) }
  else stat.tn++
}

// ---------------- 单场景扫描 ----------------
function runScenario(def) {
  const S = K.makeScenario({ system: def.system, ...def })
  const POS_TOL_KM = BASE_POS_TOL_KM * (def.scaleKm / 7000)
  const stats = newStats()
  let cells = 0, consistencyErrors = 0
  const consistencyCases = []

  function makeCache() {
    const m = new Map()
    return (method, nPerOrbit, orbits) => {
      const key = `${method}|${nPerOrbit}|${orbits}`
      if (m.has(key)) return m.get(key)
      const nSteps = Math.max(1, Math.round(orbits * nPerOrbit))
      if (nSteps > MAX_STEPS_PER_RUN) { skippedByBudget++; m.set(key, null); return null }
      const r = K.propagate({ method, nPerOrbit, orbits, sc: S })
      stepsUsed += r.steps
      m.set(key, r)
      return r
    }
  }

  for (const method of METHODS) {
    const theory = K.METHODS[method].order
    for (const orbits of def.arcs) {
      const cache = makeCache()
      const cal = K.calibrateTruncation({ method, orbits, sc: S })
      const floor = K.probeFloor({ method, orbits, cal, sc: S })

      for (const n of N_LIST) {
        cells++
        const main = cache(method, n, orbits)
        if (!main) { for (const k of Object.keys(stats)) stats[k].na++; continue }

        const al = K.alarmCheck({
          method, nPerOrbit: n, orbits,
          targetRelEnergyErr: ENERGY_TOL, targetPosErrKm: POS_TOL_KM,
          sc: S, cal, floor,
        })
        const fired = new Set(al.triggeredRules)
        const cellTag = `${def.key} | ${method} | n=${n} | ${orbits}圈`

        const exclusivityOk = !(fired.has('R1') && fired.has('R6')) && (!fired.has('R4') || fired.size === 1)
        if (!exclusivityOk) {
          consistencyErrors++
          consistencyCases.push(`${cellTag}：触发了 ${[...fired].join('、')}（违反互斥约定）`)
        }

        // 合格性类
        const posFail = main.positionErrorKm > POS_TOL_KM
        const needFlag = main.diverged || posFail
        const didFlag = fired.has('R1') || fired.has('R4') || fired.has('R6')
        tally(stats.eligibility, didFlag, needFlag, {
          cell: cellTag,
          detail: `位置 ${main.positionErrorKm.toExponential(3)} km（阈值 ${POS_TOL_KM.toExponential(2)}）`
            + `｜比能量 ${main.relEnergyError.toExponential(3)}｜发散 ${main.diverged}`
            + `｜触发 [${[...fired].join(',') || '无'}]`,
        })

        // R2 真值：六点阶梯
        if (!main.diverged) {
          const pts = [0.25, 0.5, 1, 2, 4, 8].map((k) => Math.max(2, Math.round(n * k)))
          const rs = pts.map((p) => cache(method, p, orbits))
          if (rs.every((r) => r && !r.diverged && r.positionErrorKm > 0 && Number.isFinite(r.positionErrorKm))) {
            const truthPower = fitSlope(pts, rs.map((r) => r.positionErrorKm))
            tally(stats.R2, fired.has('R2'), truthPower / theory < 0.6, {
              cell: cellTag,
              detail: `真值六点幂次 ${truthPower.toFixed(3)}（理论 ${theory}，比值 ${(truthPower / theory).toFixed(2)}）`
                + `｜规则四点幂次 ${Number.isFinite(al.metrics.globalOrderPos) ? al.metrics.globalOrderPos.toFixed(3) : 'n/a'}`,
            })
          } else stats.R2.na++
        } else stats.R2.na++

        // R3 真值：细分 16 倍
        const finer16 = cache(method, n * 16, orbits)
        if (!main.diverged && finer16 && !finer16.diverged
          && main.positionErrorKm > 0 && finer16.positionErrorKm > 0) {
          const improvement = main.positionErrorKm / finer16.positionErrorKm
          const impR = al.metrics.runtimeRefineImprovement
          tally(stats.R3, fired.has('R3'), improvement < 2, {
            cell: cellTag,
            detail: `真值：细分 16 倍改善 ${improvement.toFixed(3)} 倍（< 2 即判在平台）`
              + `｜规则细分 ${al.metrics.runtimeRefineFactor} 倍改善 ${impR == null ? 'n/a' : Number(impR).toFixed(3)} 倍`
              + `｜标定下界上限 ${al.metrics.ceilingStepsPerOrbitPos ?? '未测出'}`,
          })
        } else stats.R3.na++

        // R5 真值：4× 弧段内误差是否曾经越过阈值。
        //   与规则用同一类度量（全时段最大值）才可比 —— 末态误差对终点相位敏感，
        //   会让「真值」本身也抖（见 diag-arc-growth.mjs）。
        //   规则只用 2× 弧段（省一半算力），所以跨越点若落在 (2×, 4×) 之间就会漏报，
        //   这就是这个廉价代理的固有代价，统计要把它量出来而不是掩盖。
        if (!main.diverged) {
          const nStepsQ = Math.round(orbits * 4 * n)
          let truthR5 = null
          let qDesc = '（超出步数预算，未评估）'
          if (nStepsQ <= MAX_STEPS_PER_RUN) {
            const quad = K.propagate({ method, nPerOrbit: n, orbits: orbits * 4, sc: S, trackMaxError: true })
            stepsUsed += quad.steps
            qDesc = quad.diverged ? '发散' : quad.maxPositionErrorKm.toExponential(3) + ' km'
            truthR5 = (main.positionErrorKm <= POS_TOL_KM)
              && (quad.diverged || quad.maxPositionErrorKm > POS_TOL_KM)
          } else {
            skippedByBudget++
          }
          tally(stats.R5, fired.has('R5'), truthR5, {
            cell: cellTag,
            detail: `真值：当前弧段末态${main.positionErrorKm <= POS_TOL_KM ? '合格' : '已不合格'}`
              + `（${main.positionErrorKm.toExponential(3)} km），4× 弧段（${orbits * 4} 圈）内最大误差 ${qDesc}`
              + `｜规则用 2× 弧段最大误差判定`,
          })
        } else stats.R5.na++
      }
    }
  }
  return { def, S, posTolKm: POS_TOL_KM, stats, cells, consistencyErrors, consistencyCases }
}

// ---------------- 主流程 ----------------
console.log('='.repeat(100))
console.log('报警器误报率 / 漏报率网格统计（多场景）')
console.log('='.repeat(100))
console.log(`位置阈值按轨道尺度等比缩放：posTol = ${BASE_POS_TOL_KM} km × (a / 7000)；比能量阈值统一 ${ENERGY_TOL.toExponential(0)}`)
console.log(`网格：${METHODS.length} 方法 × ${N_LIST.length} 档步长 × 2 种弧段 = ${METHODS.length * N_LIST.length * 2} 单元/场景`)
console.log('')
for (const d of SCENARIOS) {
  const s = K.makeScenario({ system: d.system, ...d })
  const geo = s.systemKey === 'sho'
    ? `振幅 ${s.amplitude.toFixed(0).padStart(6)} km  ω=${s.omega.toExponential(3)}`
    : `a=${String(d.semiMajorAxisKm).padStart(6)} km  e=${String(d.eccentricity).padEnd(7)}`
      + `  近地点 ${s.rPeriapsis.toFixed(0).padStart(6)} / 远地点 ${s.rApoapsis.toFixed(0).padStart(6)} km`
  console.log(`  ${d.key.padEnd(6)} ${(s.systemName).padEnd(18)} ${geo}`
    + `  T=${s.period.toFixed(0).padStart(6)} s  弧段 [${d.arcs.join(',')}] 圈`
    + `  位置阈值 ${(BASE_POS_TOL_KM * d.scaleKm / 7000).toExponential(2)} km`)
}

const results = SCENARIOS.map(runScenario)

// ---------------- 逐场景统计 ----------------
const pct = (x, d) => (d > 0 ? (x / d * 100).toFixed(1) + '%' : '—')
const rate = (s) => ({
  fpRate: pct(s.fp, s.fp + s.tn),
  fnRate: pct(s.fn, s.fn + s.tp),
  recall: pct(s.tp, s.tp + s.fn),
  acc: pct(s.tp + s.tn, s.tp + s.tn + s.fp + s.fn),
})

for (const r of results) {
  console.log('')
  console.log('='.repeat(100))
  console.log(`场景【${r.def.label}】 a=${r.def.semiMajorAxisKm} km，e=${r.def.eccentricity}`)
  console.log('='.repeat(100))
  console.log(`${'规则'.padEnd(22)}${'TP'.padEnd(6)}${'FP'.padEnd(6)}${'FN'.padEnd(6)}${'TN'.padEnd(6)}${'N/A'.padEnd(6)}`
    + `${'误报率'.padEnd(9)}${'漏报率'.padEnd(9)}${'召回率'.padEnd(9)}${'准确率'}`)
  console.log('-'.repeat(100))
  for (const key of Object.keys(r.stats)) {
    const s = r.stats[key], v = rate(s)
    console.log(`${s.label.padEnd(22)}${String(s.tp).padEnd(6)}${String(s.fp).padEnd(6)}${String(s.fn).padEnd(6)}`
      + `${String(s.tn).padEnd(6)}${String(s.na).padEnd(6)}${v.fpRate.padEnd(9)}${v.fnRate.padEnd(9)}${v.recall.padEnd(9)}${v.acc}`)
  }
  console.log('-'.repeat(100))
  console.log(`单元 ${r.cells} 个；内部一致性违反 ${r.consistencyErrors} 次`)
}

// ---------------- 跨场景汇总 ----------------
const agg = {}
for (const key of Object.keys(results[0].stats)) {
  agg[key] = emptyStat(results[0].stats[key].label, results[0].stats[key].how)
  for (const r of results) {
    const s = r.stats[key]
    agg[key].tp += s.tp; agg[key].fp += s.fp; agg[key].fn += s.fn; agg[key].tn += s.tn; agg[key].na += s.na
    agg[key].cases.push(...s.cases)
  }
}

console.log('')
console.log('='.repeat(100))
const totalCells = results.reduce((a, r) => a + r.cells, 0)
  console.log(`跨 ${SCENARIOS.length} 场景汇总（${totalCells} 单元）`)
console.log('='.repeat(100))
console.log(`${'规则'.padEnd(22)}${'TP'.padEnd(6)}${'FP'.padEnd(6)}${'FN'.padEnd(6)}${'TN'.padEnd(6)}${'N/A'.padEnd(6)}`
  + `${'误报率'.padEnd(9)}${'漏报率'.padEnd(9)}${'召回率'.padEnd(9)}${'准确率'}`)
console.log('-'.repeat(100))
for (const key of Object.keys(agg)) {
  const s = agg[key], v = rate(s)
  console.log(`${s.label.padEnd(22)}${String(s.tp).padEnd(6)}${String(s.fp).padEnd(6)}${String(s.fn).padEnd(6)}`
    + `${String(s.tn).padEnd(6)}${String(s.na).padEnd(6)}${v.fpRate.padEnd(9)}${v.fnRate.padEnd(9)}${v.recall.padEnd(9)}${v.acc}`)
}
console.log('-'.repeat(100))

// ---------------- 置信区间（Clopper-Pearson）----------------
// 为什么需要这一段：0/N 不等于"真的零"，只能说"在 N 次观测里没出现"。
// 给出单侧置信上界后，断言才是可站住的——样本量越大，上界越紧。
console.log('')
console.log('='.repeat(100))
// emit = 同时打印到屏幕并写入留档（避免"屏幕有、文件没有"的不一致）
const lines = []
const emit = (s = '') => { console.log(s); lines.push(s) }

emit('置信区间（Clopper-Pearson 精确方法；单侧上界）')
emit('='.repeat(100))
emit('含义：在 N 次观测中一次都没出现时，"真实比率高于该上界"的概率不超过 5% / 1%。')
emit('')
emit(`${'规则'.padEnd(22)}${'误报/分母'.padEnd(12)}${'点估计'.padEnd(9)}${'95% 上界'.padEnd(11)}${'99% 上界'.padEnd(11)}`
  + `│ ${'漏报/分母'.padEnd(12)}${'点估计'.padEnd(9)}${'95% 上界'.padEnd(11)}${'99% 上界'}`)
emit('-'.repeat(120))
for (const key of Object.keys(agg)) {
  const s = agg[key]
  const nFp = s.fp + s.tn, nFn = s.fn + s.tp
  const pct = (v) => (v * 100).toFixed(2) + '%'
  const fpCell = nFp > 0
    ? `${String(s.fp + '/' + nFp).padEnd(12)}${pct(s.fp / nFp).padEnd(9)}`
      + `${pct(cpUpper(s.fp, nFp, 0.05)).padEnd(11)}${pct(cpUpper(s.fp, nFp, 0.01)).padEnd(11)}`
    : `${'—'.padEnd(12)}${'—'.padEnd(9)}${'—'.padEnd(11)}${'—'.padEnd(11)}`
  const fnCell = nFn > 0
    ? `${String(s.fn + '/' + nFn).padEnd(12)}${pct(s.fn / nFn).padEnd(9)}`
      + `${pct(cpUpper(s.fn, nFn, 0.05)).padEnd(11)}${pct(cpUpper(s.fn, nFn, 0.01)).padEnd(11)}`
    : `${'—'.padEnd(12)}${'—'.padEnd(9)}${'—'.padEnd(11)}${'—'.padEnd(11)}`
  emit(`${s.label.padEnd(22)}${fpCell}│ ${fnCell}`)
}
emit('-'.repeat(120))
emit('注：分栏含义——误报率的分母是"实际不该报警的"（真阴性+假阳性），')
emit('    漏报率的分母是"实际该报警的"（真阳性+假阴性）。分母为零时记「—」。')

// 逐场景漏报率对比（最能看出规则是否随场景退化）
console.log('')
console.log('逐场景漏报率对比（检查规则是否随场景退化）')
console.log(`${'规则'.padEnd(22)}` + results.map((r) => r.def.label.padEnd(16)).join('') + '汇总')
console.log('-'.repeat(100))
for (const key of Object.keys(agg)) {
  const cells = results.map((r) => {
    const s = r.stats[key]
    const d = s.tp + s.fn
    return (d > 0 ? (s.fn / d * 100).toFixed(1) + '%' : '—').padEnd(16)
  })
  const sa = agg[key], da = sa.tp + sa.fn
  console.log(`${agg[key].label.padEnd(22)}` + cells.join('') + (da > 0 ? (sa.fn / da * 100).toFixed(1) + '%' : '—'))
}
console.log('-'.repeat(100))

console.log('')
console.log('内部一致性（R1 与 R6 互斥、R4 独占）')
for (const r of results) {
  console.log(`  ${r.def.label.padEnd(14)} 检查 ${String(r.cells).padStart(3)} 单元，违反 ${r.consistencyErrors} 次`
    + `${r.consistencyErrors === 0 ? ' —— 全部符合' : ''}`)
  for (const c of r.consistencyCases.slice(0, 5)) console.log(`      · ${c}`)
}

// ---------------- 误判样本 ----------------
console.log('')
console.log('='.repeat(100))
console.log('误判样本明细（全部场景合并；这是统计数字背后最该看的部分）')
console.log('='.repeat(100))
for (const key of Object.keys(agg)) {
  const s = agg[key]
  if (!s.cases.length) {
    console.log('')
    console.log(`【${s.label}】无任何误判（TP=${s.tp}，TN=${s.tn}，N/A=${s.na}）`)
    continue
  }
  const fps = s.cases.filter((c) => c.type === '假阳性')
  const fns = s.cases.filter((c) => c.type === '假阴性')
  console.log('')
  console.log(`【${s.label}】共 ${s.cases.length} 例误判（假阳性 ${fps.length}，假阴性 ${fns.length}）`)
  console.log(`  真值定义：${s.how}`)
  for (const c of s.cases.slice(0, 14)) {
    console.log(`    ${c.type}｜${c.cell}`)
    console.log(`      ${c.detail}`)
  }
  if (s.cases.length > 14) console.log(`    …… 其余 ${s.cases.length - 14} 例见 CSV`)
}

// 按场景统计误判数，看哪个场景最容易出问题
console.log('')
console.log('误判按场景分布')
console.log(`${'规则'.padEnd(22)}` + results.map((r) => r.def.label.padEnd(16)).join(''))
console.log('-'.repeat(100))
for (const key of Object.keys(agg)) {
  const cells = results.map((r) => {
    const s = r.stats[key]
    return `${s.fp + s.fn} 例`.padEnd(16)
  })
  console.log(`${agg[key].label.padEnd(22)}` + cells.join(''))
}
console.log('-'.repeat(100))

console.log('')
console.log('='.repeat(100))
console.log(`总计算量：约 ${(stepsUsed / 1e6).toFixed(1)} 百万步；因步数超预算被跳过 ${skippedByBudget} 次`)
console.log('='.repeat(100))

// ---------------- 写文件 ----------------
lines.push('报警器误报率/漏报率网格统计（多场景版）')
lines.push(`位置阈值 = ${BASE_POS_TOL_KM} km × (a/7000)；比能量阈值 = ${ENERGY_TOL.toExponential(0)}`)
lines.push(`网格：${METHODS.join('/')} × n=[${N_LIST.join(',')}] × 每场景 2 种弧段 = ${results[0].cells} 单元/场景`)
lines.push('')
lines.push('== 逐场景 ==')
for (const r of results) {
  lines.push(`-- ${r.def.label}（a=${r.def.semiMajorAxisKm}, e=${r.def.eccentricity}, 位置阈值 ${r.posTolKm.toExponential(2)} km）`)
  lines.push('规则,TP,FP,FN,TN,N/A,误报率,漏报率,召回率,准确率,真值定义')
  for (const key of Object.keys(r.stats)) {
    const s = r.stats[key], v = rate(s)
    lines.push([s.label, s.tp, s.fp, s.fn, s.tn, s.na, v.fpRate, v.fnRate, v.recall, v.acc, s.how].join(','))
  }
  lines.push('')
}
lines.push('== 跨场景汇总 ==')
lines.push('规则,TP,FP,FN,TN,N/A,误报率,漏报率,召回率,准确率,真值定义')
for (const key of Object.keys(agg)) {
  const s = agg[key], v = rate(s)
  lines.push([s.label, s.tp, s.fp, s.fn, s.tn, s.na, v.fpRate, v.fnRate, v.recall, v.acc, s.how].join(','))
}
writeFileSync(join(outDir, 'grid-eval.txt'), lines.join('\n'), 'utf-8')

const csv = ['scenario,rule,verdict,method,nPerOrbit,orbits,detail']
for (const key of Object.keys(agg)) {
  for (const c of agg[key].cases) {
    const m = c.cell.match(/^(\S+) \| (\S+) \| n=(\d+) \| (\d+)圈$/)
    csv.push([m ? m[1] : '', key, c.type, m ? m[2] : '', m ? m[3] : '', m ? m[4] : '', `"${c.detail}"`].join(','))
  }
}
writeFileSync(join(outDir, 'grid-eval.csv'), csv.join('\n'), 'utf-8')

console.log('')
console.log(`已写出：${join(outDir, 'grid-eval.txt')}`)
console.log(`已写出：${join(outDir, 'grid-eval.csv')}`)
process.exit(0)

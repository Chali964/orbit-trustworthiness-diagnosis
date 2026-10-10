/**
 * 积分器选用参考表（生成器）
 * ==============================
 * 回答一个实际问题：**给定任务和精度要求，该选哪个积分器、每圈要多少步？**
 *
 * 数据全部由内核的 calibrateStep 现场标定（不是抄来的经验值），
 * 所以随内核一起更新，不会出现"文档写 400 步、实际要 500 步"的漂移。
 *
 * 运行：node integrator-guide.mjs
 * 输出：屏幕表格 + out/integrator-guide.txt
 */
import { __kernel as K } from './index.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');

// ── 四个代表性场景（覆盖尺度与形状两个变化方向）──────────────
const SCENARIOS = [
  { label: '近地轨道', a: 7000, e: 0.05 },
  { label: '地球同步轨道', a: 42164, e: 0.0001 },
  { label: '大偏心率椭圆', a: 12000, e: 0.45 },
  { label: '极端偏心率椭圆', a: 70000, e: 0.9 },
];

// ── 三档精度要求（用「相对轨道尺度」表述，便于横向比较）────────
// 档位的选取原则：对应「工程上真的会提的要求」，不是越严越好。
// 目标设得过严会让所有低阶方法都"不可达"，表格信息量反而下降。
const TARGETS = [
  { label: '粗估级', desc: '相对 1e-6（近地轨道约 7 米）', rel: 1e-6 },
  { label: '工程级', desc: '相对 1e-8（近地轨道约 7 厘米）', rel: 1e-8 },
  { label: '严苛级', desc: '相对 1e-10（近地轨道约 0.7 毫米）', rel: 1e-10 },
];

const METHODS = K.METHOD_NAMES;
const lines = [];
const say = (s = '') => { console.log(s); lines.push(s); };

say('='.repeat(96));
say('积分器选用参考表（数据由 calibrateStep 现场标定）');
say('='.repeat(96));

// ── 第一部分：方法特性（静态信息）──────────────────────────────
say('');
say('一、五种积分器的基本特性');
say('-'.repeat(96));
say(`${'方法'.padEnd(18)}${'理论阶'.padEnd(8)}${'稳定性'.padEnd(24)}${'含义'}`);
say('-'.repeat(96));
const TRAITS = {
  rk4: ['4', '条件稳定（步长足够小）', '效率最高，多数场景首选'],
  heun: ['2', '稳定', '二阶，实现简单'],
  midpoint: ['2', '稳定', '二阶，与改进欧拉同阶'],
  leapfrog: ['2', '长期稳定（辛结构）', '能量有界振荡、不漂移，长弧段首选'],
  euler: ['1', '条件不稳定', '本类问题不可用（误差非幂律，标定不可靠）'],
};
for (const m of METHODS) {
  const t = TRAITS[m] || ['', '', ''];
  say(`${K.METHODS[m].name.padEnd(18)}${t[0].padEnd(8)}${t[1].padEnd(24)}${t[2]}`);
}

// ── 第二部分：实测标定 ────────────────────────────────────────
for (const tg of TARGETS) {
  say('');
  say('='.repeat(96));
  say(`二、达「${tg.label}」精度所需步数（${tg.desc}）`);
  say('='.repeat(96));
  say('说明：数字是「每圈步数」。带 * 号表示该步数已超出本工具设定的搜索上限（并非不可达，只是代价大）。');
  say('      标定不可靠的方法记为「不可预测」——它们不服从幂律，任何步数建议都不可信。');
  say('');
  say(`${'场景'.padEnd(20)}${'尺度 a (km)'.padEnd(14)}` + METHODS.map((m) => K.METHODS[m].name.slice(0, 8).padEnd(14)).join(''));
  say('-'.repeat(100));

  for (const sc of SCENARIOS) {
    const row = [];
    for (const m of METHODS) {
      let cell = '';
      try {
        const r = K.calibrateStep({
          method: m, orbits: 2,
          semiMajorAxisKm: sc.a, eccentricity: sc.e,
          targetPosErrKm: tg.rel * sc.a,
        });
        if (!r.calibrationReliable) {
          cell = '不可预测';
        } else if (r.requiredStepsPerOrbitPos == null) {
          cell = '—';
        } else {
          const n = Math.round(r.requiredStepsPerOrbitPos);
          cell = n.toLocaleString('en-US') + (r.feasiblePos ? '' : '*');
        }
      } catch (err) {
        cell = '拒绝';
      }
      row.push(cell);
    }
    say(`${sc.label.padEnd(20)}${String(sc.a).padEnd(14)}` +
      row.map((c) => c.padEnd(14)).join(''));
  }
  say('-'.repeat(100));
}

// ── 第三部分：决策流程 ────────────────────────────────────────
say('');
say('='.repeat(96));
say('三、怎么选（决策流程）');
say('='.repeat(96));
say('');
say('  第一步：问「弧段有多长」');
say('    · 只算几圈以内  → 走第二步');
say('    · 要算几百圈以上 → 直接用辛积分器（leapfrog）。');
say('      理由：它的能量误差是「有界振荡」而非「单调漂移」，长弧段不会累积。');
say('');
say('  第二步：问「精度要求多高」');
say('    · 常规工程精度  → RK4（四阶，相同精度下步数最少）');
say('    · 只需要粗估    → 中点法或改进欧拉（二阶，实现简单）');
say('');
say('  第三步：不要选前向欧拉');
say('    它是唯一的一阶方法，而且对二体问题「条件不稳定」——');
say('    误差随时间指数增长，不服从幂律，本工具的标定会直接判定「不可用」并拒绝给步数。');
say('    这不是缺陷，是正确行为：宁可说不可用，也不返回基于假假设的数字。');
say('');
say('  第四步：无论如何，用工具验一遍');
say('    以上是经验排序。真正该用多少步，用 calibrate_step 对「你的具体配置」现场标定——');
say('    同样的方法，在近地圆轨道和极端偏心椭圆上需要的步数能差一个数量级以上（见上表）。');

// ── 第四部分：一个必须知道的陷阱 ──────────────────────────────
say('');
say('='.repeat(96));
say('四、一个容易踩的陷阱：辛积分器要用「位置」口径标定');
say('='.repeat(96));
say('');
say('  对 RK4、改进欧拉、中点法：用守恒量口径标定，拟合优度更高。');
say('  对辛积分器（leapfrog）：必须改用位置口径。');
say('');
say('  原因：辛积分器的能量误差是「有界振荡」，末值受相位影响，拟合成幂律会得到假的幂次；');
say('  而位置误差是「相位累积」，服从干净的幂律。');
say('  实测（diagnose.mjs）：leapfrog 位置口径 p = 1.999 / R² = 1.00000；');
say('                        守恒量口径 p = 5.359 / R² = 0.97694（明显不可靠）。');
say('');
say('  本工具的 calibrate_step 会自动按拟合优度选择口径，不需要使用者判断——');
say('  但如果手工算，这个坑必须知道。');

// 写文件
try { mkdirSync(OUT, { recursive: true }); } catch {}
writeFileSync(join(OUT, 'integrator-guide.txt'), lines.join('\n'), 'utf-8');
say('');
say(`已写出：${join(OUT, 'integrator-guide.txt')}`);

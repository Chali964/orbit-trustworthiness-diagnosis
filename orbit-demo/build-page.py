#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""读取 out/chart-data.json，生成自包含的课题示范讲解页（图表内嵌，无外部依赖）。"""
import io
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(BASE)
with io.open(os.path.join(BASE, "out", "chart-data.json"), encoding="utf-8") as f:
    DATA = json.load(f)

S = DATA["scenario"]
CONV = DATA["convergence"]
NORM = DATA["normal"]
EUL = DATA["euler"]

conv_rows = "\n".join(
    "<tr><td class=\"c\">%d</td><td class=\"c\">%.4f</td><td class=\"c\">%.3e</td>"
    "<td class=\"c\">%.3e</td><td class=\"c\">%.4e</td></tr>"
    % (c["n"], c["dt"], c["rel_energy_err"], c["rel_h_err"], c["pos_err_km"])
    for c in CONV
)

norm_last = NORM["rel_energy_err"][-1]
norm_h_last = NORM["rel_h_err"][-1]
norm_pos_last = NORM["pos_err_km"][-1]
eul_last = EUL["rel_energy_err"][-1]
eul_pos_last = EUL["pos_err_km"][-1]

TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>课题示范 · 轨道递推与守恒量校验</title>
<style>
  :root{
    --bg:#f6f7f9; --card:#fff; --line:#e3e6ec; --line2:#cfd5df;
    --ink:#1a1f29; --ink2:#4a5464; --ink3:#7b869a;
    --brand:#1d5fd0; --brand2:#eaf1fd; --brand3:#cfe0fa;
    --hot:#c62828; --hot2:#fdecec; --hot3:#f4cccc;
    --ok:#1f7a4d; --ok2:#e8f5ee; --ok3:#b6ddc7;
    --warn:#9a6200; --warn2:#fdf3e3; --warn3:#efdcb4;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
    font-size:15px;line-height:1.76}
  .wrap{max-width:1000px;margin:0 auto;padding:28px 20px 80px}
  header.hero{background:linear-gradient(158deg,#0f3468 0%,#1d5fd0 52%,#3a86e8 100%);color:#fff;
    border-radius:16px;padding:28px 28px 24px;margin-bottom:22px}
  header.hero .kicker{font-size:11.8px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;margin-bottom:8px}
  header.hero h1{margin:0 0 10px;font-size:25px;line-height:1.42;font-weight:700}
  header.hero p{margin:0;font-size:14px;opacity:.94}
  header.hero .kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.25)}
  @media(max-width:820px){header.hero .kpi{grid-template-columns:repeat(2,1fr)}}
  header.hero .kpi div{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);border-radius:10px;padding:9px 11px}
  header.hero .kpi .v{font-size:17px;font-weight:700;line-height:1.25}
  header.hero .kpi .l{font-size:11.4px;opacity:.9;margin-top:2px}

  h2{font-size:19px;margin:38px 0 12px;padding-left:12px;border-left:4px solid var(--brand);line-height:1.35}
  h3{font-size:15.4px;margin:22px 0 8px}
  p{margin:9px 0}

  table{width:100%;border-collapse:collapse;margin:13px 0;font-size:13.6px;background:var(--card)}
  th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}
  th{background:#f0f3f8;font-weight:600;color:var(--ink2);font-size:12.8px}
  td.c{text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}

  .note{background:var(--brand2);border:1px solid var(--brand3);border-radius:10px;padding:13px 16px;font-size:13.9px;margin:14px 0}
  .note.warn{background:var(--warn2);border-color:var(--warn3)}
  .note.hot{background:var(--hot2);border-color:var(--hot3)}
  .note.ok{background:var(--ok2);border-color:var(--ok3)}
  .note .nt{display:block;font-weight:700;margin-bottom:4px}

  pre{background:#f3f5f9;border:1px solid var(--line);border-radius:10px;padding:13px 15px;overflow-x:auto;font-size:13px;line-height:1.7;margin:11px 0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.7px}
  pre code{color:#243;background:none;padding:0}
  p code,td code,li code{background:#f3f5f9;border:1px solid var(--line);border-radius:5px;padding:1px 6px}

  .chart{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px 10px;margin:14px 0}
  .chart h4{margin:0 0 4px;font-size:14.6px}
  .chart .cap{font-size:12.8px;color:var(--ink2);margin:0 0 8px}
  .chart canvas{width:100%;height:auto;display:block}
  .legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.8px;color:var(--ink2);margin:6px 0 0}
  .legend i{display:inline-block;width:14px;height:3px;border-radius:2px;vertical-align:middle;margin-right:5px}

  .tag{display:inline-block;font-size:11.5px;padding:1px 8px;border-radius:20px;border:1px solid;line-height:1.7;white-space:nowrap}
  .t-ok{color:var(--ok);border-color:var(--ok3);background:var(--ok2)}
  .t-info{color:var(--brand);border-color:var(--brand3);background:var(--brand2)}
  .t-hot{color:var(--hot);border-color:var(--hot3);background:var(--hot2)}
  .t-warn{color:var(--warn);border-color:var(--warn3);background:var(--warn2)}

  ol.loop{padding-left:0;list-style:none;counter-reset:s}
  ol.loop>li{position:relative;padding:13px 16px 13px 52px;background:var(--card);border:1px solid var(--line);
    border-radius:11px;margin:10px 0;counter-increment:s}
  ol.loop>li::before{content:counter(s);position:absolute;left:15px;top:13px;width:24px;height:24px;border-radius:7px;
    background:var(--brand);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center}
  ol.loop>li .st{font-weight:700;font-size:14.5px}
  ol.loop>li .d{font-size:13.5px;color:var(--ink2);margin-top:3px}
  ol.loop>li .d b{color:var(--ink)}
  footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);font-size:12.7px;color:var(--ink3);line-height:1.75}
  @media print{.chart,table,.note{break-inside:avoid}body{background:#fff}}
</style>
</head>
<body>
<div class="wrap">

<header class="hero">
  <div class="kicker">Topic Demo · B3 科学计算与仿真</div>
  <h1>课题示范：轨道递推与守恒量校验</h1>
  <p>一个完全可运行的示例 —— 数值积分、守恒量校验、解析解对照、收敛阶标定，四件事在一个脚本里做完</p>
  <div class="kpi">
    <div><div class="v">RK4</div><div class="l">定步长四阶龙格-库塔</div></div>
    <div><div class="v">4.2 ~ 4.7</div><div class="l">实测观测收敛阶</div></div>
    <div><div class="v">5.6e-13</div><div class="l">正常样例比能量相对误差</div></div>
    <div><div class="v">12 个量级</div><div class="l">欧拉与 RK4 的误差差距</div></div>
  </div>
</header>

<h2>一、这个示范演示了什么</h2>
<div class="note ok">
  <span class="nt">三件事，构成一个完整的「可验证」作品骨架</span>
  <b>① 守恒量自校验</b>——比能量与比角动量在正确的数值积分下应当守恒。不需要查任何外部数据，漂移本身就是判据。<br>
  <b>② 解析真值对照</b>——二体问题有精确解（开普勒方程），所以位置误差可以对照<u>真值</u>，而不是对照一个「更细的近似解」。<br>
  <b>③ 收敛阶标定</b>——误差随步长的幂次关系可以实测出来，用观测阶与理论阶对照，反过来证明实现是对的。
</div>

<h2>二、场景设定</h2>
<table>
  <tr><th style="width:220px">参数</th><th style="width:170px">取值</th><th>说明</th></tr>
  <tr><td>半长轴 a</td><td class="c">@@A@@ km</td><td>近地轨道量级</td></tr>
  <tr><td>偏心率 e</td><td class="c">@@ECC@@</td><td>接近圆轨道，但保留轻微椭率以便观察</td></tr>
  <tr><td>近地点半径</td><td class="c">@@RP@@ km</td><td>地面高度约 @@ALT@@ km</td></tr>
  <tr><td>远地点半径</td><td class="c">@@RA@@ km</td><td>由 a(1+e) 得出</td></tr>
  <tr><td>轨道周期 T</td><td class="c">@@PERIOD@@ s</td><td>约 @@PERIODMIN@@ 分钟</td></tr>
  <tr><td>比能量 ε 理论值</td><td class="c">@@E0@@ km²/s²</td><td>闭式解 −μ/2a</td></tr>
  <tr><td>比角动量 h 理论值</td><td class="c">@@H0@@ km²/s</td><td>闭式解 √(μa(1−e²))</td></tr>
  <tr><td>积分时长</td><td class="c">@@ORBITS@@ 圈</td><td>约 @@SPAN@@ s</td></tr>
</table>
<div class="note">
  <span class="nt">为什么选这个场景</span>
  ① 它没有任何外部数据依赖——初值自己定，真值自己算，三类样例自己造；<br>
  ② 它有明确的物理不变量，自动化校验的条件天然满足；<br>
  ③ 它是航空航天专业的标准问题，答辩时不需要额外铺垫背景。
</div>

<h2>三、数值实现</h2>
<p>二体问题运动方程（平面情形，状态量为 <code>[x, y, vx, vy]</code>）：</p>
<pre><code>dr/dt = v
dv/dt = −μ · r / |r|³</code></pre>
<p>用定步长四阶龙格-库塔积分。四阶的取点结构是：在区间内取 4 个斜率估计，按 <code>(k₁ + 2k₂ + 2k₃ + k₄)/6</code> 加权。</p>
<pre><code>k₁ = f(y)
k₂ = f(y + dt/2 · k₁)
k₃ = f(y + dt/2 · k₂)
k₄ = f(y + dt · k₃)
y ← y + dt/6 · (k₁ + 2k₂ + 2k₃ + k₄)</code></pre>
<p>校验用的两个守恒量：</p>
<pre><code>比能量      ε = |v|²/2 − μ/|r|          （理论值 −μ/2a）
比角动量    h = x·vy − y·vx            （理论值 √(μa(1−e²))）</code></pre>
<p>解析真值由开普勒方程 <code>M = E − e·sin E</code> 牛顿迭代求解，再换算回位置与速度。所以下面的「位置误差」是<u>与精确解的偏差</u>，不是与近似解的偏差。</p>

<h2>四、结果一：守恒量误差随时间的变化</h2>
<p>同样积分 @@ORBITS@@ 圈。RK4 每圈 2000 步，前向欧拉也是每圈 2000 步——唯一的差别是积分方法。</p>

<div class="chart">
  <h4>比能量相对误差 vs 轨道圈数（半对数坐标）</h4>
  <p class="cap">纵轴为 |ε(t) − ε₀| / |ε₀|，取对数。RK4 的曲线被压在量的底部；欧拉的误差随时间线性累积。</p>
  <canvas id="c1" width="900" height="320"></canvas>
  <div class="legend">
    <span><i style="background:#1d5fd0"></i>RK4（正常样例）</span>
    <span><i style="background:#c62828"></i>前向欧拉（失败样例）</span>
  </div>
</div>

<table>
  <tr><th style="width:190px">指标</th><th style="width:190px">RK4（每圈 2000 步）</th><th>前向欧拉（同步长）</th></tr>
  <tr><td>比能量相对误差（末值）</td><td class="c">@@NE@@</td><td class="c">@@EE@@</td></tr>
  <tr><td>比角动量相对误差（末值）</td><td class="c">@@NH@@</td><td class="c">见图中曲线</td></tr>
  <tr><td>位置误差 vs 解析解</td><td class="c">@@NP@@ km</td><td class="c">@@EP@@ km</td></tr>
  <tr><td>误差随时间的行为</td><td class="c">有界，无系统漂移</td><td class="c">线性累积，持续增长</td></tr>
</table>

<h2>五、结果二：轨道轨迹对比</h2>
<p>这张图比任何表格都直观。同一个初值、同一个步长，只换积分方法：</p>

<div class="chart">
  <h4>轨道轨迹（平面投影，单位 km）</h4>
  <p class="cap">RK4 的轨迹严格落在理论椭圆上；欧拉的轨道被持续「泵高」，远地点一路外扩。</p>
  <canvas id="c2" width="900" height="420"></canvas>
  <div class="legend">
    <span><i style="background:#1d5fd0"></i>RK4 轨迹</span>
    <span><i style="background:#c62828"></i>前向欧拉轨迹</span>
    <span><i style="background:#7b869a"></i>地球（半径 @@RE@@ km）</span>
  </div>
</div>

<div class="note hot">
  <span class="nt">数字上的证据</span>
  RK4 的轨道半径全程落在 <b>6650 ~ 7350 km</b>，这正好是理论近地点 a(1−e)=6650 km 与远地点 a(1+e)=7350 km —— 形状被完整保持。<br>
  前向欧拉的轨道半径被抬高到 <b>最高 @@EULMAX@@ km</b>，即远地点凭空多出约 @@EULGAIN@@ km。这就是「能量不守恒」在几何上的样子。
</div>

<h2>六、结果三：收敛阶标定</h2>
<p>把步长逐级减半，看误差怎么降。四阶方法理论上步长减半误差应降为约 1/16。</p>

<div class="chart">
  <h4>位置误差 vs 每圈步数（双对数坐标）</h4>
  <p class="cap">双对数坐标下若呈直线，斜率即为收敛阶。虚线为斜率 4 的参考线。</p>
  <canvas id="c3" width="900" height="340"></canvas>
</div>

<table>
  <tr><th>每圈步数</th><th>步长 (s)</th><th>比能量相对误差</th><th>比角动量相对误差</th><th>位置误差 (km)</th></tr>
@@CONVROWS@@
</table>

<div class="note">
  <span class="nt">怎么读这张表</span>
  步长每减半，位置误差下降约一个数量级多一点，反推出的观测阶落在 <b>4.2 ~ 4.7</b> 区间，与 RK4 的理论阶 4 一致。<br>
  更细的步长下观测阶更接近 4；粗步长时观测阶偏高，是因为此时误差还没进入渐近区（高阶项仍占一定比重）——这个现象本身也值得在作品里说明一句，它体现了对数值方法的理解深度。
</div>

<h2>七、三类测试样例汇总</h2>
<table>
  <tr><th style="width:120px">样例</th><th style="width:210px">设置</th><th>结果</th><th style="width:110px">用途</th></tr>
  <tr>
    <td><b>正常</b></td>
    <td>RK4，每圈 2000 步，@@ORBITS@@ 圈</td>
    <td>比能量相对误差 @@NE@@，位置误差约 @@NPM@@ m</td>
    <td>证明实现正确</td>
  </tr>
  <tr>
    <td><b>边界</b></td>
    <td>RK4，每圈仅 40 步（步长 @@CDT@@ s）</td>
    <td>未发散但位置误差已达约 @@CPOS@@ km —— 数值上稳定、精度上不可用</td>
    <td>标定可用步长下限</td>
  </tr>
  <tr>
    <td><b>失败</b></td>
    <td>前向欧拉，每圈 2000 步</td>
    <td>比能量相对误差 @@EE@@，位置误差 @@EP@@ km，轨道被抬高 @@EULGAIN@@ km</td>
    <td>证明校验有效</td>
  </tr>
</table>
<div class="note">
  <span class="nt">失败样例才是校验环节的关键</span>
  一个只会说「我的结果是对的」的校验没有说服力。<b>能主动造出一个失败案例，并且让校验机制把它识别出来</b>，才证明这套校验真的在工作——这同时也是赛事「验证严谨性与异常处理」那一项的得分点。
</div>

<h2>八、结论：这个课题的核心论点</h2>
<div class="note ok" style="font-size:14.3px">
  把上面三组结果串起来，作品要讲的一句话是：<br><br>
  <b>「不同的数值方法在同样的步长下，守恒量的保持能力相差 12 个量级；而这个差距无法靠肉眼看结果判断——必须用守恒量与解析解去校验。所以科学计算需要自动化的验证环节。」</b><br><br>
  这句话同时立住了问题价值（为什么要做校验）、结果正确性（有量化证据）和验证严谨性（有失败样例）三项得分。
</div>

<h2>九、映射到 AGH 的 ≥3 步闭环</h2>
<p>上面这个示范目前是一个独立脚本。搬进比赛作品时，要把它拆成由 AGH 编排的多步任务流——这也是赛事「必须以 AGH 为底座、经 AGH 完成至少三个连续步骤」的要求所在。</p>

<ol class="loop">
  <li>
    <div class="st">任务规划</div>
    <div class="d">解析轨道初值，选定候选数值方法与候选步长序列，明确校验指标（能量误差阈值、角动量误差阈值、位置误差阈值）。<b>这一步的产物是一份可执行的实验计划。</b></div>
  </li>
  <li>
    <div class="st">能力调用</div>
    <div class="d">把数值积分器作为<b>外部工具</b>接入并调用。注意：AGH 的 Python 运行时目前是未实现状态，所以求解器要以外部进程或服务的形式存在，通过后端插件或 MCP 接入，而不是把 Python 脚本塞进 AGH 内部执行。</div>
  </li>
  <li>
    <div class="st">反馈处理</div>
    <div class="d">读回守恒量误差。若超过阈值，<b>自动缩短步长重算</b>；若收敛阶明显偏离理论值，标记该次实验为异常。这一步是「反馈改变了后续决策」的实例，也是本科组「AGH 与模型执行闭环」那 20 分的直接对应物。</div>
  </li>
  <li>
    <div class="st">结果验证</div>
    <div class="d">与开普勒解析解对照位置误差，输出「可用步长区间」的结论，并附三类样例的完整执行记录。</div>
  </li>
</ol>

<div class="note warn">
  <span class="nt">实施顺序上的一个建议</span>
  <b>先把脚本跑通，再做编排。</b>数值实现本身是可以独立验证的（就像这个示范），确认物理与数值都对之后，再把它包成 AGH 能调用的工具。反过来先搭编排、后调数值，一旦结果不对，你分不清是数值错了还是编排错了。
</div>

<h2>十、文件清单与复现方法</h2>
<table>
  <tr><th style="width:300px">文件</th><th>内容</th></tr>
  <tr><td><code>orbit-demo/propagate.py</code></td><td>完整实现（纯标准库，不需要 numpy）。含开普勒解析解、RK4、前向欧拉、守恒量校验、收敛阶标定</td></tr>
  <tr><td><code>orbit-demo/out/timeseries_rk4_n2000.csv</code></td><td>正常样例完整时间序列，20001 个采样点，含 t、位置速度、能量、角动量与三类误差</td></tr>
  <tr><td><code>orbit-demo/out/timeseries_euler_n2000.csv</code></td><td>失败样例时间序列</td></tr>
  <tr><td><code>orbit-demo/out/convergence.csv</code></td><td>收敛阶标定表</td></tr>
  <tr><td><code>orbit-demo/out/chart-data.json</code></td><td>本页图表使用的数据（已降采样至约 200 点）</td></tr>
  <tr><td><code>orbit-demo/out/run-log.txt</code></td><td>脚本的完整输出日志，可用于人工核查</td></tr>
</table>
<p>复现只需一条命令（本机 Python 3.13 实测通过）：</p>
<pre><code>cd orbit-demo && python propagate.py</code></pre>

<h2>十一、核实档位</h2>
<table>
  <tr><th style="width:190px">档位</th><th>适用范围</th></tr>
  <tr><td><span class="tag t-ok">已实测</span></td><td>本页全部数值结果——收敛阶 4.2~4.7、RK4 误差 5.6e-13、欧拉误差 2.3e-01、轨道半径范围、三类样例结论，均由本地脚本实跑得出</td></tr>
  <tr><td><span class="tag t-ok">已核实·官方仓库</span></td><td>AGH 的 Python 运行时为未实现状态；后端插件与 MCP 是官方接入方式</td></tr>
  <tr><td><span class="tag t-info">解析真值</span></td><td>开普勒方程解为二体问题的精确解，非近似参考解，故位置误差对照的是真值</td></tr>
  <tr><td><span class="tag t-hot">推断</span></td><td>第九节的 AGH 闭环拆解与实施顺序建议——是我的设计判断，非官方推荐</td></tr>
  <tr><td><span class="tag t-hot">未覆盖</span></td><td>本示范为二体问题。加入 J2 等摄动项后能量仍守恒但轨道不再闭合，角动量只有分量守恒——该情形未在本示范内实现</td></tr>
</table>

<footer>
  2026-09-30 · 示范代码与数据均可本地复现，无外部依赖<br>
  本页为课题结构参考，用于理解「轨道递推与守恒量校验」这一类课题的做法，并非赛事官方示例。
</footer>

</div>

<script>
var DATA = @@DATA@@;

function drawAxes(ctx, W, H, pad, xlab, ylab) {
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#cfd5df'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, H - pad.b);
  ctx.stroke();
  ctx.fillStyle = '#7b869a'; ctx.font = '12px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
}
function grid(ctx, W, H, pad, ys, yToPix, fmt) {
  ctx.save();
  ctx.strokeStyle = '#eef1f6'; ctx.lineWidth = 1;
  ctx.fillStyle = '#7b869a'; ctx.font = '11.5px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ys.forEach(function (v) {
    var y = yToPix(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(fmt(v), pad.l - 8, y);
  });
  ctx.restore();
}
function poly(ctx, xs, ys, xToPix, yToPix, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.beginPath();
  var started = false;
  for (var i = 0; i < xs.length; i++) {
    var y = ys[i];
    if (!isFinite(y)) { started = false; continue; }
    var px = xToPix(xs[i]), py = yToPix(y);
    if (py < -1e5 || py > 1e5) { started = false; continue; }
    if (!started) { ctx.moveTo(px, py); started = true; } else { ctx.lineTo(px, py); }
  }
  ctx.stroke();
}

/* 图 1：比能量相对误差 vs 圈数（半对数） */
(function () {
  var c = document.getElementById('c1'), ctx = c.getContext('2d');
  var W = c.width, H = c.height, pad = { l: 74, t: 16, r: 16, b: 42 };
  var FLOOR = 1e-16;
  var series = [
    { x: DATA.normal.orbits, y: DATA.normal.rel_energy_err, color: '#1d5fd0', w: 2.4 },
    { x: DATA.euler.orbits, y: DATA.euler.rel_energy_err, color: '#c62828', w: 2.4 }
  ];
  var xmax = DATA.normal.orbits[DATA.normal.orbits.length - 1];
  var lo = -16, hi = 0;
  var xToPix = function (v) { return pad.l + (W - pad.l - pad.r) * (v / xmax); };
  var yToPix = function (v) {
    var lv = Math.log(Math.max(v, FLOOR)) / Math.LN10;
    return H - pad.b - (H - pad.t - pad.b) * ((lv - lo) / (hi - lo));
  };
  var ticks = []; for (var e = lo; e <= hi; e += 4) ticks.push(Math.pow(10, e));
  grid(ctx, W, H, pad, ticks, yToPix, function (v) {
    var lv = Math.round(Math.log(v) / Math.LN10);
    return '1e' + lv;
  });
  series.forEach(function (s) {
    poly(ctx, s.x, s.y.map(function (v) { return Math.max(v, FLOOR); }), xToPix, yToPix, s.color, s.w);
  });
  ctx.fillStyle = '#7b869a'; ctx.font = '11.5px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (var k = 0; k <= 5; k++) ctx.fillText((xmax * k / 5).toFixed(0), xToPix(xmax * k / 5), H - pad.b + 7);
  ctx.fillText('轨道圈数', (pad.l + W - pad.r) / 2, H - 14);
  ctx.save(); ctx.translate(16, (pad.t + H - pad.b) / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('比能量相对误差（对数）', 0, 0); ctx.restore();
})();

/* 图 2：轨道轨迹对比 */
(function () {
  var c = document.getElementById('c2'), ctx = c.getContext('2d');
  var W = c.width, H = c.height, pad = { l: 54, t: 16, r: 16, b: 38 };
  var ext = 0, all = DATA.normal.x.concat(DATA.normal.y, DATA.euler.x, DATA.euler.y);
  all.forEach(function (v) { ext = Math.max(ext, Math.abs(v)); });
  ext = Math.max(ext, 6378.137) * 1.06;
  var cx = (pad.l + W - pad.r) / 2, cy = (pad.t + H - pad.b) / 2;
  var scale = Math.min(W - pad.l - pad.r, H - pad.t - pad.b) / (2 * ext);
  var P = function (x) { return cx + x * scale; };
  var Q = function (y) { return cy - y * scale; };

  ctx.clearRect(0, 0, W, H);
  var Re = 6378.137;
  ctx.beginPath(); ctx.arc(cx, cy, Re * scale, 0, 2 * Math.PI);
  ctx.fillStyle = '#eef1f6'; ctx.fill();
  ctx.strokeStyle = '#cfd5df'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#7b869a'; ctx.font = '11.5px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('地球', cx, cy);

  function trace(xs, ys, color, width, dash) {
    ctx.save();
    if (dash) ctx.setLineDash(dash);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
    for (var i = 0; i < xs.length; i++) {
      if (i === 0) ctx.moveTo(P(xs[i]), Q(ys[i])); else ctx.lineTo(P(xs[i]), Q(ys[i]));
    }
    ctx.stroke(); ctx.restore();
  }
  trace(DATA.euler.x, DATA.euler.y, '#c62828', 1.8, [5, 3]);
  trace(DATA.normal.x, DATA.normal.y, '#1d5fd0', 2.2);
})();

/* 图 3：收敛阶（双对数） */
(function () {
  var c = document.getElementById('c3'), ctx = c.getContext('2d');
  var W = c.width, H = c.height, pad = { l: 78, t: 16, r: 20, b: 46 };
  var vals = DATA.convergence.slice().sort(function (a, b) { return b.n - a.n; });
  var xs = vals.map(function (v) { return v.n; });
  var ys = vals.map(function (v) { return v.pos_err_km; });
  var xToPix = function (n) {
    var l = Math.log(n) / Math.LN10;
    var lo = Math.log(xs[0]) / Math.LN10, hi = Math.log(xs[xs.length - 1]) / Math.LN10;
    return pad.l + (W - pad.l - pad.r) * ((l - lo) / (hi - lo));
  };
  var ymin = Math.min.apply(null, ys) * 0.35, ymax = Math.max.apply(null, ys) * 2.2;
  var yToPix = function (v) {
    var l = Math.log(v) / Math.LN10;
    return H - pad.b - (H - pad.t - pad.b) * ((l - Math.log(ymin) / Math.LN10) / (Math.log(ymax) / Math.LN10 - Math.log(ymin) / Math.LN10));
  };
  var ticks = []; var p = Math.floor(Math.log(ymin) / Math.LN10);
  for (; p <= Math.ceil(Math.log(ymax) / Math.LN10); p++) ticks.push(Math.pow(10, p));
  grid(ctx, W, H, pad, ticks, yToPix, function (v) { return v.toExponential(0); });

  /* 斜率 4 参考线：过中间点 */
  var mid = Math.floor(xs.length / 2);
  var rx1 = xs[0], ry1 = ys[0];
  var rx2 = xs[xs.length - 1], ry2 = ry1 * Math.pow(rx1 / rx2, 4);
  ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = '#b0b8c6'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(xToPix(rx1), yToPix(ry1)); ctx.lineTo(xToPix(rx2), yToPix(ry2)); ctx.stroke();
  ctx.restore();

  /* 数据点 + 连线 */
  ctx.strokeStyle = '#1d5fd0'; ctx.lineWidth = 2.2; ctx.beginPath();
  for (var i = 0; i < xs.length; i++) {
    var px = xToPix(xs[i]), py = yToPix(ys[i]);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.fillStyle = '#1d5fd0';
  for (var j = 0; j < xs.length; j++) {
    ctx.beginPath(); ctx.arc(xToPix(xs[j]), yToPix(ys[j]), 3.6, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.fillStyle = '#b0b8c6'; ctx.font = '11.5px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.fillText('斜率 4 参考线', xToPix(rx2) - 96, yToPix(ry2) - 4);

  ctx.fillStyle = '#7b869a'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  xs.forEach(function (n) { ctx.fillText(String(n), xToPix(n), H - pad.b + 7); });
  ctx.fillText('每圈步数（对数）', (pad.l + W - pad.r) / 2, H - 20);
  ctx.save(); ctx.translate(18, (pad.t + H - pad.b) / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('位置误差 km（对数）', 0, 0); ctx.restore();
})();
</script>
</body>
</html>
"""

vals = {
    "@@DATA@@": json.dumps(DATA, ensure_ascii=False),
    "@@A@@": "%.0f" % S["a_km"],
    "@@ECC@@": "%.3f" % S["e"],
    "@@RP@@": "%.0f" % S["r_perigee_km"],
    "@@ALT@@": "%.1f" % (S["r_perigee_km"] - 6378.137),
    "@@RA@@": "%.0f" % (S["a_km"] * (1 + S["e"])),
    "@@RE@@": "%.1f" % 6378.137,
    "@@PERIOD@@": "%.1f" % S["period_s"],
    "@@PERIODMIN@@": "%.2f" % (S["period_s"] / 60.0),
    "@@E0@@": "%.6f" % S["energy0"],
    "@@H0@@": "%.6f" % S["h0"],
    "@@ORBITS@@": "%d" % S["orbits"],
    "@@SPAN@@": "%.1f" % (S["period_s"] * S["orbits"]),
    "@@CONVROWS@@": conv_rows,
    "@@NE@@": "%.3e" % norm_last,
    "@@NH@@": "%.3e" % norm_h_last,
    "@@NP@@": "%.4e" % norm_pos_last,
    "@@NPM@@": "%.3f" % (norm_pos_last * 1000),
    "@@EE@@": "%.3e" % eul_last,
    "@@EP@@": "%.1f" % eul_pos_last,
    "@@CDT@@": "%.1f" % CONV[0]["dt"],
    "@@CPOS@@": "%.2f" % CONV[0]["pos_err_km"],
    "@@EULMAX@@": "%.0f" % max(
        [((x * x + y * y) ** 0.5) for x, y in zip(EUL["x"], EUL["y"])]),
    "@@EULGAIN@@": "%.0f" % (
        max([((x * x + y * y) ** 0.5) for x, y in zip(EUL["x"], EUL["y"])])
        - S["a_km"] * (1 + S["e"])),
}

html = TEMPLATE
for k, v in vals.items():
    html = html.replace(k, v)
if "@@" in html:
    i = html.find("@@")
    raise SystemExit("PLACEHOLDER_LEFTOVER at %d: ...%s..." % (i, html[max(0, i - 60):i + 40].replace("\n", "\\n")))

out = os.path.join(ROOT, "轨道递推与守恒量校验-课题示范.html")
with io.open(out, "w", encoding="utf-8") as f:
    f.write(html)
print("WRITTEN", out, os.path.getsize(out), "bytes")

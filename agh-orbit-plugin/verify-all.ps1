# ============================================================
# 一键复现：依次运行全部验收脚本，汇总结果
# ============================================================
# 用法（在 PowerShell 窗口里）：
#   powershell -ExecutionPolicy Bypass -File "verify-all.ps1"
#   powershell -ExecutionPolicy Bypass -File "verify-all.ps1" -Full
#
# 为什么提供 .ps1 / .cmd / .mjs 三个版本：
#   .mjs  —— 功能最全（含 --json、耗时统计），正常环境首选
#   .ps1  —— 不依赖 Node 的 spawn（某些受限环境下 spawn 会 EBUSY）
#   .cmd  —— 纯批处理兜底
# ============================================================

param(
    [switch]$Full
)

$ErrorActionPreference = 'Continue'
$HERE = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $HERE

# 用 PATH 里的 node；若你的 Node 装在别处，把下面这行改成完整路径即可
$NODE = 'node'
if (-not (Get-Command $NODE -ErrorAction SilentlyContinue)) {
    Write-Output '找不到 node。请把本脚本顶部的 $NODE 改成 Node 的完整路径（需要 22 或更高版本）。'
    exit 2
}

# ── 验收项清单 ────────────────────────────────────────────────
$FAST = @(
    @{ f = 'verify-kernel.mjs';           n = '内核验证' },
    @{ f = 'smoke-tools.mjs';             n = '工具冒烟测试' },
    @{ f = 'test-error-budget.mjs';       n = '误差预算验收' },
    @{ f = 'test-confidence.mjs';         n = '统计置信区间验收' },
    @{ f = 'test-external-benchmark.mjs'; n = '外部权威基准对拍' },
    @{ f = 'transfer-test.mjs';           n = '可迁移性验证' },
    @{ f = 'loop-runner.mjs';             n = '四步闭环编排' },
    @{ f = 'diagnose.mjs';                n = '方法诊断' }
)
$SLOW = @(
    @{ f = 'grid-eval.mjs';               n = '网格统计（六场景 480 单元）' },
    @{ f = 'integrator-guide.mjs';        n = '积分器选型表' }
)

$suites = if ($Full) { $FAST + $SLOW } else { $FAST }

Write-Output ('=' * 74)
Write-Output '一键复现：项目全部验收项'
Write-Output ('=' * 74)
Write-Output ("  模式：" + $(if ($Full) { '全部（含慢项）' } else { '快速集（加 -Full 可跑全部）' }))
Write-Output ("  Node：" + $NODE)
Write-Output ''

$pass = 0; $fail = 0; $failedNames = @()
$t0 = Get-Date

for ($i = 0; $i -lt $suites.Count; $i++) {
    $s = $suites[$i]
    $tag = '[{0,2}/{1}]' -f ($i + 1), $suites.Count
    if (-not (Test-Path -LiteralPath $s.f)) {
        Write-Output ("$tag {0,-28} [FAIL] 脚本不存在" -f $s.n)
        $fail++; $failedNames += $s.n
        continue
    }
    $st = Get-Date
    & $NODE $s.f > $null 2>&1
    $code = $LASTEXITCODE
    $sec = ((Get-Date) - $st).TotalSeconds
    if ($code -eq 0) {
        Write-Output ("$tag {0,-28} [OK]  {1,6:N1}s" -f $s.n, $sec)
        $pass++
    } else {
        Write-Output ("$tag {0,-28} [FAIL]  {1,6:N1}s" -f $s.n, $sec)
        $fail++; $failedNames += $s.n
    }
}

$total = ((Get-Date) - $t0).TotalSeconds
Write-Output ''
Write-Output ('=' * 74)
Write-Output ("结果：通过 $pass 项，未通过 $fail 项    总耗时 {0:N1}s" -f $total)
Write-Output ('=' * 74)
if ($fail -gt 0) {
    Write-Output ''
    Write-Output ('未通过项：' + ($failedNames -join '、'))
    Write-Output ''
    Write-Output '建议：单独运行失败项查看详细输出，例如'
    Write-Output ("  & `"$NODE`" " + $suites[0].f)
    exit 1
}
Write-Output ''
Write-Output '  [OK] 全部通过'
if (-not $Full) {
    Write-Output ''
    Write-Output '  提示：还有 2 项慢验证未跑（网格统计、选型表生成）'
    Write-Output '        需要完整复现时加 -Full 参数。'
}
exit 0

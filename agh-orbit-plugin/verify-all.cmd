@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem 一键复现：依次运行全部验收脚本，汇总结果
rem ============================================================
rem 为什么用 .cmd 而不是 Node：
rem   本项目原先的 verify-all.mjs 用 spawnSync 启动子进程，
rem   但在某些受限环境（如沙箱）下 spawn 会报 EBUSY——连 cmd.exe
rem   都起不来。批处理由 cmd 自己负责串行，不依赖 spawn，更可靠。
rem
rem 用法：
rem   verify-all.cmd            只跑快速集
rem   verify-all.cmd full       跑全部（含网格统计等慢项）
rem ============================================================

set "HERE=%~dp0"
cd /d "%HERE%"

rem 用 PATH 里的 node；若装在别处，把下面这行改成完整路径
set "NODE=node"
where %NODE% >nul 2>&1
if errorlevel 1 (
  echo 找不到 node。请把本脚本里的 NODE 改成 Node 的完整路径（需要 22 或更高版本）。
  exit /b 2
)

set "MODE=%~1"
set "PASS=0"
set "FAIL=0"
set "FAILED_LIST="

echo ======================================================================
echo 一键复现：项目全部验收项
echo ======================================================================
if /i "%MODE%"=="full" (
  echo   模式：全部^(含慢项^)
) else (
  echo   模式：快速集  ^(加参数 full 可跑全部^)
)
echo   Node：%NODE%
echo.

rem ── 快速集 ────────────────────────────────────────────────────
call :RUN "verify-kernel.mjs"          "内核验证"
call :RUN "smoke-tools.mjs"            "工具冒烟测试"
call :RUN "test-error-budget.mjs"      "误差预算验收"
call :RUN "test-confidence.mjs"        "统计置信区间验收"
call :RUN "test-external-benchmark.mjs" "外部权威基准对拍"
call :RUN "transfer-test.mjs"          "可迁移性验证"
call :RUN "loop-runner.mjs"            "四步闭环编排"
call :RUN "diagnose.mjs"               "方法诊断"

rem ── 慢项（需要 full）──────────────────────────────────────────
if /i "%MODE%"=="full" (
  call :RUN "grid-eval.mjs"            "网格统计^(六场景 480 单元^)"
  call :RUN "integrator-guide.mjs"     "积分器选型表"
)

echo.
echo ======================================================================
echo 结果：通过 %PASS% 项，未通过 %FAIL% 项
echo ======================================================================
if not "%FAILED_LIST%"=="" (
  echo.
  echo 未通过项：%FAILED_LIST%
  echo.
  echo 建议：单独运行失败项查看详细输出，例如
  echo   "%NODE%" verify-kernel.mjs
  exit /b 1
)
echo.
echo   ✓ 全部通过
if /i not "%MODE%"=="full" (
  echo.
  echo   提示：还有 2 项慢验证未跑^(网格统计、选型表生成^)
  echo         需要完整复现时执行：verify-all.cmd full
)
exit /b 0

rem ── 子过程：跑一项并累加计数 ──────────────────────────────────
:RUN
set "SCRIPT=%~1"
set "NAME=%~2"
if not exist "%SCRIPT%" (
  echo   [--] %NAME%  ✗ 脚本不存在
  set /a FAIL+=1
  set "FAILED_LIST=%FAILED_LIST% %NAME%"
  exit /b 0
)
"%NODE%" "%SCRIPT%" >nul 2>&1
if errorlevel 1 (
  echo   [✗] %NAME%
  set /a FAIL+=1
  set "FAILED_LIST=%FAILED_LIST% %NAME%"
) else (
  echo   [✓] %NAME%
  set /a PASS+=1
)
exit /b 0

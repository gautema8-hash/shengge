# 「生格」服务独立启动/停止脚本（脱离会话生命周期，进程不被对话轮次回收）
# 用法：powershell -File tools\start-services.ps1   （重复执行安全：先停后起）

$ROOT  = "D:\sofa\aiproject\workBuddyWork\person_dev"
$NODE  = "C:\Users\xuyan\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
$NP    = "C:\Users\xuyan\.workbuddy\binaries\node\workspace\node_modules"
$DIST  = "$ROOT\app\frontend\dist"
$ADIST = "$ROOT\admin\frontend\dist"
$LOG   = "$ROOT\server-data\logs"
New-Item -ItemType Directory -Force -Path $LOG | Out-Null

# ── 清理代理变量：①服务出站不走代理；②大小写冲突键(HTTPS_PROXY/https_proxy 并存)会使 Start-Process 构建环境块失败 ──
'http_proxy','https_proxy','all_proxy','no_proxy','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY' |
  ForEach-Object { [Environment]::SetEnvironmentVariable($_, $null) | Out-Null }

# ── 停止旧实例（按 PID 文件，兜底按端口找）──
foreach ($name in @("app", "admin")) {
  $pidFile = "$LOG\$name.pid"
  if (Test-Path $pidFile) {
    $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($oldPid) { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}
Get-NetTCPConnection -LocalPort 8101,8102 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 600

# ── 启动（独立进程，不受会话影响；NODE_PATH 由子进程继承当前环境）──
$env:NODE_PATH = $NP

$p1 = Start-Process -FilePath $NODE -ArgumentList "server.js --frontend=$DIST" -WorkingDirectory "$ROOT\app\backend" `
  -WindowStyle Hidden -PassThru -RedirectStandardOutput "$LOG\app.out.log" -RedirectStandardError "$LOG\app.err.log"
$p1.Id | Set-Content "$LOG\app.pid"

$p2 = Start-Process -FilePath $NODE -ArgumentList "server.js --frontend=$ADIST" -WorkingDirectory "$ROOT\admin\backend" `
  -WindowStyle Hidden -PassThru -RedirectStandardOutput "$LOG\admin.out.log" -RedirectStandardError "$LOG\admin.err.log"
$p2.Id | Set-Content "$LOG\admin.pid"

Start-Sleep -Seconds 3

$health1 = $null; $health2 = $null
try { $health1 = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8101/api/v1/health" -TimeoutSec 5).Content } catch {}
try { $health2 = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8102/api/admin/health" -TimeoutSec 5).Content } catch {}

Write-Host "app(8101)  PID=$($p1.Id) => $health1"
Write-Host "admin(8102) PID=$($p2.Id) => $health2"
Write-Host "日志: $LOG"

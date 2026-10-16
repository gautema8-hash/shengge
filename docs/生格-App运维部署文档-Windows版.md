# 生格-App运维部署文档（Windows 版）

> 版本：v1.0 ｜ 适用：`app/backend`（Node.js ≥18，默认端口 8101）+ `app/frontend`
> 系统：Windows Server 2019+ / Windows 10/11；服务化使用 NSSM（开源），不写批处理脚本避免中文路径编码问题

---

## 1. 快速启动指南（已有环境跳到 §2）

```powershell
# 前置：Node.js >= 18（检查当前已装的受管版本亦可）
node -v    # >= 18 即可

# 1) 目录布局（推荐）
# C:\shengge\
# ├── releases\<时间戳>\        # 每次发布一个目录
# ├── current\                  # 目录联接(junction)，回滚靠它
# ├── server-data\              # db.json / secret.key / mysql-credentials.json
# ├── logs\
# └── tools\nssm.exe

# 2) 取代码到 releases 目录
New-Item -ItemType Directory -Force C:\shengge\releases\, C:\shengge\server-data\, C:\shengge\logs\, C:\shengge\tools\
# 把 app\、server-data\ 内容拷入对应位置（git clone / scp / 手工拷贝）

# 3) 建立联接并前台验证
cmd /c mklink /J C:\shengge\current C:\shengge\releases\v1
Set-Location C:\shengge\current\app\backend
$env:SG_PORT="8101"; node server.js     # 前台验证，Ctrl+C 退出

# 4) 验证（另开一个终端）
Invoke-WebRequest http://127.0.0.1:8101/health -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:8101/api/v1/config/hotline   # 热线下发必须非空
```

---

## 2. 标准部署步骤

### 2.1 环境要求

| 项 | 要求 |
|----|------|
| Node.js | ≥ 18（建议 20 LTS） |
| 端口 | 8101（可 `SG_PORT` 覆盖） |
| 目录 | `C:\shengge\`，服务数据 `C:\shengge\server-data\` |
| 下载 NSSM | https://nssm.cc/download → `nssm.exe` 放入 `C:\shengge\tools\` |

### 2.2 注册为 Windows 服务（NSSM）

```powershell
C:\shengge\tools\nssm.exe install shengge-app "C:\Program Files\nodejs\node.exe" "server.js"
# 用 node.exe 实际路径（Get-Command node 确认；受管版本为 C:\Users\<用户>\.workbuddy\binaries\node\versions\...）

C:\shengge\tools\nssm.exe set shengge-app AppDirectory C:\shengge\current\app\backend
C:\shengge\tools\nssm.exe set shengge-app AppEnvironmentExtra SG_PORT=8101 NODE_ENV=production
C:\shengge\tools\nssm.exe set shengge-app AppStdout C:\shengge\logs\app.log
C:\shengge\tools\nssm.exe set shengge-app AppStderr C:\shengge\logs\app.err.log
C:\shengge\tools\nssm.exe set shengge-app AppRotateFiles 1          # 日志轮转
C:\shengge\tools\nssm.exe set shengge-app AppRotateOnline 1
C:\shengge\tools\nssm.exe set shengge-app AppRotateBytes 10485760   # 10MB 切割
C:\shengge\tools\nssm.exe set shengge-app AppExit Default Restart
C:\shengge\tools\nssm.exe set shengge-app AppRestartDelay 5000      # 崩溃5秒后自动拉起

Start-Service shengge-app
Get-Service shengge-app
```

> 备选方案：`sc.exe create`（exe 型服务不适用 node 直启）或 Windows 任务计划程序"开机启动"。NSSM 是最省心的方案。

### 2.3 数据目录与权限

```powershell
# 限制 secret.key 访问（当前用户之外移除权限）
icacls C:\shengge\server-data\secret.key /inheritance:r /grant:r "$env:USERNAME:F"
```

> 注意：代码通过相对路径 `..\..\server-data\db.json` 读取数据，`server-data` 必须位于 `current` 的父级（即 `C:\shengge\server-data`），与上面布局一致。

### 2.4 反向代理（对外，可选 IIS 或 Caddy）

**Caddy（最简，自动 HTTPS）：**

```
# C:\shengge\tools\Caddyfile
api.shengge.example.com {
    reverse_proxy 127.0.0.1:8101
}
```

```powershell
C:\shengge\tools\caddy.exe start --config C:\shengge\tools\Caddyfile
# 也可用 nssm 把 caddy 注册为服务
```

### 2.5 发布流程（版本目录化）

```powershell
# 1) 新版本拷入 releases\<新时间戳>\
Copy-Item -Recurse -Force app C:\shengge\releases\<新时间戳>\app
# 2) 停服务 → 切联接 → 起服务（junction 指向被占用目录时需先停）
Stop-Service shengge-app
cmd /c rmdir C:\shengge\current
cmd /c mklink /J C:\shengge\current C:\shengge\releases\<新时间戳>
Start-Service shengge-app
# 3) 自动冒烟
try { Invoke-WebRequest http://127.0.0.1:8101/health -TimeoutSec 5 -UseBasicParsing | Out-Null }
catch {
  Write-Output "冒烟失败，立即回滚"
  Stop-Service shengge-app
  cmd /c rmdir C:\shengge\current
  cmd /c mklink /J C:\shengge\current C:\shengge\releases\<旧时间戳>
  Start-Service shengge-app
}
```

---

## 3. 备份与回滚方案

### 3.1 每日备份（计划任务 + PowerShell）

```powershell
# C:\shengge\scripts\backup.ps1 —— 计划任务每天 02:00 执行
$ErrorActionPreference = "Stop"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$dir = "C:\shengge\backups"
New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item C:\shengge\server-data\db.json "$dir\db_$ts.json"
# JSON 完整性校验
try { Get-Content "$dir\db_$ts.json" -Raw | ConvertFrom-Json | Out-Null; "$ts backup ok" | Add-Content C:\shengge\logs\backup.log }
catch { "$ts backup INVALID" | Add-Content C:\shengge\logs\backup.log; exit 1 }
# 本地保留 7 天
Get-ChildItem $dir -Filter "db_*.json" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Force
# 异地：rclone copy / 云对象存储 SDK 上传，保留 30 天
```

注册计划任务：

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\shengge\scripts\backup.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 02:00
Register-ScheduledTask -TaskName "shengge-backup" -Action $action -Trigger $trigger -RunLevel Highest
```

### 3.2 版本回滚（30 秒内完成）

```powershell
Get-ChildItem C:\shengge\releases | Sort-Object LastWriteTime -Descending | Select-Object -First 5
Stop-Service shengge-app
cmd /c rmdir C:\shengge\current
cmd /c mklink /J C:\shengge\current C:\shengge\releases\<旧时间戳>
Start-Service shengge-app
Invoke-WebRequest http://127.0.0.1:8101/health -UseBasicParsing   # 确认恢复
```

### 3.3 数据回滚（db.json 损坏/误操作时）

```powershell
Stop-Service shengge-app, shengge-admin     # 两服务共用 db.json，必须同停
Copy-Item C:\shengge\server-data\db.json C:\shengge\server-data\db.json.broken_$ts   # 留证
Copy-Item C:\shengge\backups\db_<时间戳>.json C:\shengge\server-data\db.json -Force
Get-Content C:\shengge\server-data\db.json -Raw | ConvertFrom-Json | Out-Null   # 校验
Start-Service shengge-app, shengge-admin
Invoke-RestMethod http://127.0.0.1:8101/api/v1/config/hotline   # 确认热线数据完好
```

> ⚠️ 回滚数据会丢失备份点之后的增量（含审计日志），操作前先备份当前损坏文件留证。

---

## 4. 常见问题排查

| 现象 | 排查命令 | 处置 |
|------|---------|------|
| 服务起不来 | `Get-EventLog -LogName Application -Source nssm -Newest 10`、`Get-Content C:\shengge\logs\app.err.log -Tail 50` | 多为 node.exe 路径错或 Node <18 |
| 端口被占 | `netstat -ano \| findstr :8101` → `tasklist /fi "PID eq <pid>"` | `taskkill /PID <pid> /F` 或改 `SG_PORT` |
| `db.json 写入失败 / EPERM` | 文件是否被占用（编辑器/杀毒软件锁文件） | 关闭占用者；杀毒软件加白名单 `C:\shengge` |
| 中文路径乱码/服务启动失败 | 目录含中文或空格 | 统一用 `C:\shengge` 英文路径（项目硬约束） |
| 题库/热线接口返回空 | 管理后台是否误操作 | 接口层有"热线不可全下线"保护；数据损坏按 §3.3 恢复 |
| 同步接口 5xx | `Get-Content C:\shengge\logs\app.err.log -Tail 50` | 多为 db.json JSON 损坏 → 校验 + 回滚数据 |
| 重启后服务未自启 | `Get-Service shengge-app`（StartupType） | `Set-Service shengge-app -StartupType Automatic` |
| 计划任务没跑 | `Get-ScheduledTaskInfo shengge-backup` | 检查上次运行时间/结果码，注意执行账户需可访问 C:\shengge |

### 日志位置

- 应用日志：`C:\shengge\logs\app.log`、`app.err.log`（NSSM 已配置 10MB 自动轮转）
- 服务事件：事件查看器 → Windows 日志 → 应用程序（来源 nssm）

---

## 5. 安全基线清单（上线前核对）

- [ ] 远程桌面仅限内网/VPN，启用 NLA
- [ ] 防火墙仅放行 80/443（及 3389 受限来源），8101/8102 不对公网
- [ ] `secret.key` 已限权，不进版本库
- [ ] 服务用专用低权限账户运行（NSSM `ObjectName` 可设）
- [ ] 备份计划任务已配置且做过一次恢复演练
- [ ] 探针告警（每 5 分钟）已接入通知渠道
- [ ] Windows 更新与 Defender 保持开启，`C:\shengge` 加排除项避免锁文件

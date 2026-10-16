# 生格-管理后台运维文档（Windows 版）

> 版本：v1.0 ｜ 适用：`admin/backend`（Node.js ≥18，默认端口 8102）+ `admin/frontend`
> 系统：Windows Server 2019+ / Windows 10/11；服务化使用 NSSM
> ⚠️ 管理后台包含题库/热线/敏感词管理与审计日志，**禁止直接对公网暴露 8102**，必须经反向代理白名单/VPN 访问。

---

## 1. 快速启动指南（已有环境跳到 §2）

```powershell
# 前置：Node.js >= 18
node -v    # >= 18 即可

# 1) 目录布局（与 App 后端同机共存）
# C:\shengge\
# ├── releases\<时间戳>\
# ├── current\                  # 目录联接(junction)
# ├── server-data\              # ★ 两服务共享同一份 db.json / secret.key
# ├── logs\
# └── tools\nssm.exe

# 2) 启动（前台验证）
Set-Location C:\shengge\current\admin\backend
$env:SG_PORT="8102"; node server.js

# 3) 验证（另开一个终端）
Invoke-WebRequest http://127.0.0.1:8102/health -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:8102/api/admin/dashboard
# 浏览器打开 http://<本机IP>:8102/ —— 静态托管 admin\frontend
```

---

## 2. 标准部署步骤

### 2.1 环境要求

| 项 | 要求 |
|----|------|
| Node.js | ≥ 18（建议 20 LTS） |
| 端口 | 8102（可 `SG_PORT` 覆盖）；公网仅暴露 443 |
| 目录 | `C:\shengge\`（与 app/backend 共享 `C:\shengge\server-data\`） |
| 访问 | 仅内网 / VPN / 指定运维 IP |
| 下载 NSSM | https://nssm.cc/download → `nssm.exe` 放入 `C:\shengge\tools\` |

### 2.2 注册为 Windows 服务（NSSM）

```powershell
C:\shengge\tools\nssm.exe install shengge-admin "C:\Program Files\nodejs\node.exe" "server.js"
# node.exe 实际路径用 Get-Command node 确认

C:\shengge\tools\nssm.exe set shengge-admin AppDirectory C:\shengge\current\admin\backend
C:\shengge\tools\nssm.exe set shengge-admin AppEnvironmentExtra SG_PORT=8102 NODE_ENV=production
C:\shengge\tools\nssm.exe set shengge-admin AppStdout C:\shengge\logs\admin.log
C:\shengge\tools\nssm.exe set shengge-admin AppStderr C:\shengge\logs\admin.err.log
C:\shengge\tools\nssm.exe set shengge-admin AppRotateFiles 1
C:\shengge\tools\nssm.exe set shengge-admin AppRotateOnline 1
C:\shengge\tools\nssm.exe set shengge-admin AppRotateBytes 10485760
C:\shengge\tools\nssm.exe set shengge-admin AppExit Default Restart
C:\shengge\tools\nssm.exe set shengge-admin AppRestartDelay 5000

Start-Service shengge-admin
Get-Service shengge-admin
```

> 数据文件与 app 后端共用：`admin\backend` 同样按 `..\..\server-data\db.json` 相对路径读取，`server-data` 必须位于 `current` 父级。后台改题库/热线 → App 端 `/api/v1/config/*` 下发即时生效，无需重启 app 服务。

### 2.3 反向代理 + 访问收敛（必须）

**Caddy 方案（最简）：**

```
# C:\shengge\tools\Caddyfile
admin.shengge.example.com {
    @allowed remote_ip 10.0.0.0/8 <运维办公出口IP>
    handle @allowed {
        reverse_proxy 127.0.0.1:8102
    }
    respond 403
}
```

```powershell
C:\shengge\tools\caddy.exe start --config C:\shengge\tools\Caddyfile
```

**Windows 防火墙兜底：**

```powershell
# 8102 仅允许内网网段访问
New-NetFirewallRule -DisplayName "shengge-admin-8102" -Direction Inbound -LocalPort 8102 -Protocol TCP `
  -RemoteAddress 10.0.0.0/8,<运维IP> -Action Allow
New-NetFirewallRule -DisplayName "shengge-admin-8102-deny" -Direction Inbound -LocalPort 8102 -Protocol TCP -Action Block
```

### 2.4 发布流程（版本目录化）

```powershell
# 1) 新版本拷入 releases\<新时间戳>\
Copy-Item -Recurse -Force admin C:\shengge\releases\<新时间戳>\admin
# 2) 停服务 → 切联接 → 起服务
Stop-Service shengge-admin
cmd /c rmdir C:\shengge\current
cmd /c mklink /J C:\shengge\current C:\shengge\releases\<新时间戳>
Start-Service shengge-admin
# 3) 自动冒烟
try { Invoke-WebRequest http://127.0.0.1:8102/health -TimeoutSec 5 -UseBasicParsing | Out-Null }
catch {
  Write-Output "冒烟失败，立即回滚"
  Stop-Service shengge-admin
  cmd /c rmdir C:\shengge\current
  cmd /c mklink /J C:\shengge\current C:\shengge\releases\<旧时间戳>
  Start-Service shengge-admin
}
```

---

## 3. 备份与回滚方案

### 3.1 备份

管理后台与 App 后端**共享同一份 `db.json`**（含题库、热线、敏感词、审计日志），备份策略与 Windows 版 App 文档完全一致：

- 每日 02:00 计划任务执行 `C:\shengge\scripts\backup.ps1`（见《生格-App运维部署文档-Windows版》§3.1，同机共用即可）
- 备份后必须做 JSON 完整性校验（ConvertFrom-Json）；本地 7 天 + 异地 30 天
- **审计日志 ≥6 个月留存**是合规硬要求：本地旧备份清理前，必须确认归档切片已异地保存

### 3.2 版本回滚（30 秒内完成）

```powershell
Get-ChildItem C:\shengge\releases | Sort-Object LastWriteTime -Descending | Select-Object -First 5
Stop-Service shengge-admin
cmd /c rmdir C:\shengge\current
cmd /c mklink /J C:\shengge\current C:\shengge\releases\<旧时间戳>
Start-Service shengge-admin
Invoke-WebRequest http://127.0.0.1:8102/health -UseBasicParsing   # 确认恢复
```

> 若新旧版本间数据 schema 有变更，回滚前确认旧代码兼容当前 `db.json` 结构；必要时按 §3.3 同时回滚数据。

### 3.3 数据回滚（db.json 损坏/误操作时）

```powershell
# ★ 关键：两服务共用 db.json，必须 app + admin 同时停止再恢复
Stop-Service shengge-app, shengge-admin
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item C:\shengge\server-data\db.json "C:\shengge\server-data\db.json.broken_$ts"   # 留证
Copy-Item C:\shengge\backups\db_<时间戳>.json C:\shengge\server-data\db.json -Force
Get-Content C:\shengge\server-data\db.json -Raw | ConvertFrom-Json | Out-Null   # 校验
Start-Service shengge-app, shengge-admin
# 验证三项：看板、热线、审计
Invoke-RestMethod http://127.0.0.1:8102/api/admin/dashboard
Invoke-RestMethod http://127.0.0.1:8101/api/v1/config/hotline
```

---

## 4. 常见问题排查

| 现象 | 排查命令 | 处置 |
|------|---------|------|
| 服务起不来 | `Get-Content C:\shengge\logs\admin.err.log -Tail 50`、事件查看器（来源 nssm） | node.exe 路径错、Node <18、端口占用 |
| 端口被占 | `netstat -ano \| findstr :8102` → `tasklist /fi "PID eq <pid>"` | `taskkill /PID <pid> /F` 或改 `SG_PORT` |
| 后台页面打不开（公网） | — | 预期行为（白名单/防火墙拦截）；确认来源 IP 已加白 |
| 后台改了题库 App 未生效 | `Invoke-RestMethod http://127.0.0.1:8101/api/v1/config/questions` | 下发即时读无需重启；查 app 服务是否正常 |
| 保存时报错/写入失败 | 日志 `admin.err.log`；文件是否被杀毒软件/编辑器锁定 | 杀毒白名单 `C:\shengge`；关闭占用者 |
| 中文路径乱码/服务失败 | 目录含中文或空格 | 统一用 `C:\shengge` 英文路径（项目硬约束） |
| 热线替换被拦截 | — | 接口层强制"至少 1 条有效热线"，先新增再替换，属内置保护 |
| 审计日志缺失 | 检查 db.json 中 audit 段 | 从备份恢复；排查越权访问（检查防火墙/代理日志） |
| 两服务数据不一致 | — | 确认两服务相对路径都指向 `C:\shengge\server-data\db.json` |
| 计划任务没跑 | `Get-ScheduledTaskInfo shengge-backup` | 查上次结果码；执行账户需有 C:\shengge 权限 |

### 日志位置

- 应用日志：`C:\shengge\logs\admin.log`、`admin.err.log`（NSSM 10MB 自动轮转）
- 服务事件：事件查看器 → Windows 日志 → 应用程序（来源 nssm）

---

## 5. 安全基线清单（上线前核对，后台权限敏感度高于 App 后端）

- [ ] 8102 不对公网；反向代理白名单 + 防火墙规则已配置
- [ ] HTTPS 已启用（Caddy 自动证书）
- [ ] 后台登录使用强口令/独立账号（不复用服务器密码）
- [ ] 审计日志 ≥6 个月留存且异地归档
- [ ] `secret.key` 已限权，不进版本库
- [ ] 所有写操作自动写审计日志——用真实账号操作，不留共享账号
- [ ] 备份 + 恢复演练已验证（重点演练"热线配置恢复"）
- [ ] 探针告警已覆盖 8102（含 `/api/admin/dashboard` 可用性）
- [ ] 远程桌面仅限内网/VPN + NLA；Windows 更新与 Defender 保持开启

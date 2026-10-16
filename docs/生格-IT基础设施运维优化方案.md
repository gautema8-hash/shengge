# 生格-IT基础设施运维稳定性与效率优化方案

> 版本：v1.0 ｜ 日期：2026-10-16 ｜ 适用范围：「生格」App 后端（8101）+ 管理后台（8102）+ 共享数据层（server-data/db.json，规划中的 MySQL 8.0 / Redis 5.0）
> 编写角色：基础设施运维（Infrastructure Maintainer）

---

## 一、现状盘点与问题诊断

### 1.1 当前架构事实

| 组件 | 现状 | 风险等级 |
|------|------|---------|
| app/backend | Node.js ≥18 零依赖单进程，端口 8101，SG_PORT 可覆盖 | 高 |
| admin/backend | Node.js ≥18 零依赖单进程，端口 8102，静态托管前端 | 高 |
| 数据层 | 两服务共享 `server-data/db.json` 单 JSON 文件 | **严重** |
| 进程管理 | 无（依赖手工 `node server.js` 启动） | **严重** |
| 监控告警 | 仅有 `/health` 接口，无采集、无告警、无历史 | 高 |
| 备份恢复 | 无自动备份、无恢复演练 | **严重** |
| MySQL/Redis | 本机已装（8.0.44 / 5.0.14.1），业务未接入 | 中 |
| 访问控制 | admin 后台与 App 后端同级暴露，无网关层 | 高 |

### 1.2 稳定性问题（按优先级）

**P0-1：单点 JSON 文件存储，无崩溃隔离**
两个服务并发写同一 `db.json`，存在写冲突与文件损坏风险；一次磁盘错误即导致题库、热线（危机干预数据！）、审计日志全量丢失。热线配置属于用户安全底线，丢失不可接受。

**P0-2：裸进程运行，无守护**
进程崩溃 / 服务器重启后服务不会自动拉起，App 端题库与热线下发全部中断。对心理关怀类产品，热线接口中断 = 安全事故。

**P0-3：无备份与恢复能力**
无任何备份机制，RPO（可容忍数据丢失）目前为"全部"，RTO 未知且未演练。

**P1-1：无监控告警**
`/health` 只能人工访问，无 CPU/内存/磁盘/进程存活采集，无告警通道。故障发现只能靠用户投诉。

**P1-2：admin 后台暴露面未收敛**
管理端口（8102）与用户端口同机同网段直出，弱口令或未授权访问即触碰审计合规红线（审计日志 ≥6 个月留存的要求会被"能删库的人也能删日志"击穿）。

### 1.3 效率问题

| 问题 | 表现 | 影响 |
|------|------|------|
| 部署靠手工 | 无标准化部署脚本，Linux/Windows 步骤不一致 | 环境漂移、部署耗时且易错 |
| 无自动化流水线 | 发版 = 手工拷贝 + 手工重启 | 回滚困难，出事只能现场救火 |
| 日志分散 | stdout 即丢，无文件日志、无轮转 | 排障无依据，MTTR 拉长 |
| 资源无规划 | MySQL/Redis 空转未接入，JSON 增长无上限 | 单文件随审计日志无限膨胀，读写劣化 |

---

## 二、优化方案总览

分四个域推进，先保命（P0）、再提效（P1/P2）：

```
第一周(P0)：进程守护 → 自动备份 → 端口收敛
第二周(P1)：监控告警上线 → 日志规范 → 发布/回滚脚本化
第二个月(P2)：MySQL/Redis 接入 → 备份异地化 → 容量规划
```

---

## 三、监控告警方案

### 3.1 分层监控设计

| 层 | 采集内容 | 工具选型 | 阈值 |
|----|---------|---------|------|
| 进程层 | node 进程存活、重启次数 | PM2 内置监控 / systemd | down 1 分钟告警 |
| 系统层 | CPU>80%、内存>90%、磁盘>85%（持续 5 分钟） | Node Exporter + Prometheus（后期）；前期用脚本巡检 | 见告警分级 |
| 应用层 | `/health` 探活、`/api/v1/config/hotline` 可用性（核心业务探针） | HTTP 探针 + curl 脚本 | 连续 3 次失败 = critical |
| 数据层 | db.json 体积、mtime、备份文件新鲜度 | 巡检脚本 | 备份超 24h 未更新 = warning |

### 3.2 告警分级与响应

| 级别 | 定义 | 示例 | 响应时限 | 通道 |
|------|------|------|---------|------|
| P0/Critical | 核心功能不可用 | 服务 down、热线接口失败、备份连续失败 | 15 分钟内响应 | 电话/微信 + IM 机器人 |
| P1/Warning | 功能可用但有风险 | 磁盘 >85%、内存 >90%、5xx 率上升 | 2 小时 | IM 机器人 |
| P2/Info | 趋势类 | 审计日志体积、QPS 趋势 | 每日复盘 | 日报汇总 |

### 3.3 最小可行方案（第一周即可落地）

不引入重型栈前，用两个脚本 + 一个定时任务兜底：

**Linux（crontab，每 5 分钟）：**

```bash
#!/bin/bash
# /opt/shengge/scripts/health_probe.sh
APP_URL="http://127.0.0.1:8101/health"
ADMIN_URL="http://127.0.0.1:8102/health"
FAIL=0
curl -sf -m 5 "$APP_URL" >/dev/null   || FAIL=$((FAIL+1))
curl -sf -m 5 "$ADMIN_URL" >/dev/null || FAIL=$((FAIL+1))
if [ "$FAIL" -gt 0 ]; then
  echo "$(date '+%F %T') probe fail=$FAIL" >> /opt/shengge/logs/probe.log
  # 接入通知渠道：企业微信/钉钉机器人 webhook（模板示例，替换为真实 URL）
  # curl -X POST -H 'Content-Type: application/json' \
  #   -d '{"msgtype":"text","text":{"content":"【生格】服务探活失败"}}' "$WEBHOOK"
  systemctl restart shengge-app shengge-admin
fi
```

**Windows（计划任务 + PowerShell，每 5 分钟）：**

```powershell
# C:\shengge\scripts\health_probe.ps1
$targets = @{ "app" = "http://127.0.0.1:8101/health"; "admin" = "http://127.0.0.1:8102/health" }
foreach ($k in $targets.Keys) {
  try { Invoke-WebRequest -Uri $targets[$k] -TimeoutSec 5 -UseBasicParsing | Out-Null }
  catch {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $k down" | Add-Content C:\shengge\logs\probe.log
    # 此处接入通知（企业微信机器人 webhook）后，再执行自动拉起
    Restart-Service -Name "shengge-$k" -ErrorAction SilentlyContinue
  }
}
```

> 后期演进：接入 Prometheus + Grafana + Alertmanager（告警规则模板见附录），当前规模不必一上来就堆全家桶。

---

## 四、故障处理流程（Incident Response）

### 4.1 故障分级

| 级别 | 场景 | 示例 |
|------|------|------|
| S1 | 热线下发失败、两服务全挂、数据损坏 | db.json 损坏、磁盘满导致写入失败 |
| S2 | 单服务故障、性能劣化但可用 | app 后端 5xx、响应 >3s |
| S3 | 非核心异常 | 看板数据延迟、日志告警 |

### 4.2 标准处置流程（五步法）

```
1. 确认（5分钟内）：探针/日志确认故障范围，判定级别
2. 止血（S1≤15分钟）：优先"恢复服务"而非"找根因"
   - 进程挂 → 自动/手动拉起（systemctl restart / Restart-Service）
   - 数据异常 → 用最近一次验证过的备份恢复（见各部署文档回滚章节）
   - 版本问题 → 回滚到上一版本（部署文档回滚方案）
3. 通报：S1 每 30 分钟向相关方同步一次进展
4. 根因：止血后 24 小时内出初步分析，5 个工作日内出复盘报告
5. 复盘：输出 action item（监控补点 / 流程修正 / 代码修复），跟踪闭环
```

### 4.3 常见故障速查（Runbook 摘要）

| 现象 | 首查 | 典型处置 |
|------|------|---------|
| 服务 down | `systemctl status` / `Get-Service` | 重启；连续重启失败转数据/代码排查 |
| 端口被占 | `ss -lntp` / `netstat -ano` | kill 占用进程或改 SG_PORT |
| db.json 写失败 | 磁盘空间、文件权限 | 清理磁盘（审计日志归档），恢复权限 |
| 热线接口返回空 | 后台是否误操作全下线 | 接口层有保护，若绕过则从备份恢复 hotlines 段 |
| 内存持续上涨 | 是否开启 MySQL/Redis 连接未释放 | 重启服务 + 排查连接池 |

---

## 五、自动化运维方案

### 5.1 自动化路线

| 阶段 | 动作 | 工具 |
|------|------|------|
| 立即 | 进程守护（崩溃自动拉起、开机自启） | Linux: systemd；Windows: Windows 服务（NSSM 或 sc） |
| 立即 | 定时备份 + 保留策略 + 新鲜度检查 | cron / 计划任务 + 脚本 |
| 1 个月内 | 标准化部署与回滚脚本（本方案配套 4 份文档已内置） | bash / PowerShell |
| 1 个月内 | 日志轮转 | Linux: logrotate；Windows: 脚本按日期切割 |
| 3 个月 | 数据层迁移 MySQL（主数据）+ Redis（缓存），JSON 降级为兜底 | 现有 db.js/store.js 已预留 |
| 3 个月 | 发布流水线（lint → 冒烟测试 → 打包 → 部署 → 探活验证） | Git hooks / GitHub Actions / Jenkins 任选 |

### 5.2 备份策略（P0，第一周落地）

- **对象**：`server-data/db.json`（含题库、热线、审计日志）、`server-data/secret.key`、两服务配置
- **频率**：每日 02:00 全量；每次后台写操作后触发增量快照（crontab 每小时同步一份）
- **保留**：本地 7 天 + 异地（对象存储/另一台机器）30 天
- **校验**：备份后用 `node -e "JSON.parse(...)"` 验证 JSON 完整性；每周做一次恢复演练
- **加密**：`secret.key` 与备份文件建议 gpg 对称加密（参考备份脚本模板）

### 5.3 发布与回滚自动化

每次发布必须携带回滚能力（详见 4 份部署文档）：
- 版本目录化：`/opt/shengge/releases/<timestamp>/` + `current` 软链（Linux）；`C:\shengge\releases\<timestamp>\`（Windows 用 junction）
- 回滚 = 软链/目录指回上一版本 + 重启，30 秒内完成
- 发布后自动跑冒烟（`/health`、热线下发、auth/guest），失败自动回滚

---

## 六、资源管理方案

### 6.1 计算资源

- 当前双服务均为零依赖 Node，单实例内存基线 <150MB，2C4G 起步即可
- 上限保护：PM2/systemd 设置内存阈值自动重启（如 `max_memory_restart: 300M`）
- 预留：接入 MySQL 后建议 4C8G；并发增长后按"App 后端无状态可横向扩、admin 单实例"的原则扩展

### 6.2 存储资源

| 项 | 当前风险 | 管控措施 |
|----|---------|---------|
| db.json | 审计日志 ≥6 个月留存 → 文件无限膨胀 | ① 按 90 天归档切片（`audit-YYYYMM.json`）；② 迁移 MySQL 后按表分区 |
| 磁盘 | 日志+备份累积 | 磁盘使用率 >85% 告警，>90% 自动清理最老归档 |
| 备份 | 本地单副本 | 本地 7 天滚动 + 异地 30 天 |

### 6.3 网络与安全资源

- **端口收敛**：admin（8102）不对公网开放——Nginx 反向代理 + IP 白名单 + Basic Auth，或仅内网/VPN 访问；App 后端（8101）经 Nginx 对外，强制 HTTPS
- **证书**：Let's Encrypt 自动续期（certbot timer）
- **审计合规**：审计日志写后禁止删除（文件系统只读挂载归档 / 对象存储 WORM），满足 ≥6 个月留存
- **账号**：服务器 SSH 密钥登录禁密码；MySQL/Redis 生产账号专号专用（本机 root/root123!@# 仅限开发环境，生产必须改）

### 6.4 容量规划

| 指标 | 当前 | 3 个月预估 | 触发扩容条件 |
|------|------|-----------|-------------|
| QPS（config 下发） | 试点级 | 视投放量 | 峰值 CPU >60% 持续 1 周 |
| 数据量 | 单 JSON | MySQL 数 GB（含审计） | 单表 >1000 万行分区 |
| 内存 | <0.5G | <2G | >70% 持续 |
| 磁盘 | <10G | <50G（含备份） | >80% |

---

## 七、落地路线图与验收标准

| 时间 | 动作 | 验收标准 |
|------|------|---------|
| 第 1 周 | 进程守护 + 每日备份 + 探针告警 | kill 进程 60s 内自动恢复；备份可 JSON 校验通过；故障 5 分钟内收到通知 |
| 第 2 周 | 版本目录化发布 + 回滚脚本 + 日志轮转 | 任一版本可 30 秒回滚；日志按天落盘有轮转 |
| 第 1 个月 | admin 端口收敛 + HTTPS + 恢复演练 | 公网扫不到 8102；一次真实恢复演练通过（RTO<1h） |
| 第 3 个月 | MySQL/Redis 接入 + 归档切片 + 发布流水线 | 数据层切换零丢失；审计可查 ≥6 个月；发布全自动含冒烟 |

---

## 附录：Prometheus 告警规则（演进用）

```yaml
groups:
  - name: shengge.rules
    rules:
      - alert: ShenggeServiceDown
        expr: up{job=~"shengge-app|shengge-admin"} == 0
        for: 1m
        labels: { severity: critical }
        annotations:
          summary: "生格服务下线 {{ $labels.job }}"
      - alert: ShenggeHotlineProbeFail
        expr: probe_success{probe="hotline_config"} == 0
        for: 2m
        labels: { severity: critical }
        annotations:
          summary: "热线下发接口失败——S1级，立即处置"
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance)(irate(node_cpu_seconds_total{mode="idle"}[5m]))*100) > 80
        for: 5m
        labels: { severity: warning }
      - alert: HighMemoryUsage
        expr: (1 - node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes)*100 > 90
        for: 5m
        labels: { severity: critical }
      - alert: DiskSpaceLow
        expr: 100 - (node_filesystem_avail_bytes*100/node_filesystem_size_bytes) > 85
        for: 2m
        labels: { severity: warning }
```

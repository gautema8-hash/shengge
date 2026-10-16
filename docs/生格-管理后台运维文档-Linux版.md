# 生格-管理后台运维文档（Linux 版）

> 版本：v1.0 ｜ 适用：`admin/backend`（Node.js ≥18，默认端口 8102）+ `admin/frontend`
> 系统：Ubuntu 20.04+ / Debian / CentOS 8+（systemd 环境）
> ⚠️ 管理后台包含题库/热线/敏感词管理与审计日志，**禁止直接对公网暴露 8102**，必须经 Nginx 白名单/VPN 访问。

---

## 1. 快速启动指南（已有环境跳到 §2）

```bash
# 前置：Node.js >= 18
node -v || (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs)

# 1) 目录布局（推荐，与 App 后端同机共存）
# /opt/shengge/
# ├── releases/<时间戳>/
# ├── current -> releases/<最新>      # app 与 admin 各有启动目录，release 可同仓
# ├── server-data/                    # ★ 两服务共享同一份 db.json / secret.key
# └── logs/

# 2) 启动
cd /opt/shengge/current/admin/backend
SG_PORT=8102 node server.js          # 前台验证

# 3) 验证
curl http://127.0.0.1:8102/health
curl http://127.0.0.1:8102/api/admin/dashboard     # 看板聚合
# 浏览器打开 http://<内网IP>:8102/ —— 静态托管 admin/frontend
```

---

## 2. 标准部署步骤

### 2.1 环境要求

| 项 | 要求 |
|----|------|
| Node.js | ≥ 18（建议 20 LTS） |
| 端口 | 8102（可 `SG_PORT` 覆盖）；公网仅暴露 443 |
| 目录 | `/opt/shengge/`（与 app/backend 共享 `/opt/shengge/server-data/`） |
| 访问 | 仅内网 / VPN / 指定运维 IP |

### 2.2 systemd 服务配置

```ini
# /etc/systemd/system/shengge-admin.service
[Unit]
Description=Shengge Admin Backend (port 8102)
After=network.target shengge-app.service

[Service]
Type=simple
User=shengge
Group=shengge
WorkingDirectory=/opt/shengge/current/admin/backend
Environment=SG_PORT=8102
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_OPTIONS=--max-old-space-size=256
StandardOutput=append:/opt/shengge/logs/admin.log
StandardError=append:/opt/shengge/logs/admin.err.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shengge-admin
sudo systemctl status shengge-admin
```

> 数据文件与 app 后端共用：`admin/backend` 同样按 `../../server-data/db.json` 相对路径读取，`server-data` 必须位于 `current` 父级。后台改题库/热线 → App 端 `/api/v1/config/*` 下发即时生效，无需重启 app 服务。

### 2.3 Nginx 反向代理 + 白名单（必须）

```nginx
server {
    listen 443 ssl http2;
    server_name admin.shengge.example.com;
    ssl_certificate     /etc/letsencrypt/live/admin.shengge.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.shengge.example.com/privkey.pem;

    # IP 白名单：仅运维/运营出口 IP
    allow 10.0.0.0/8;          # 内网
    allow <运维办公出口IP>;     # 按需添加
    deny  all;

    # 可再加一层 Basic Auth（htpasswd 生成）
    # auth_basic "Shengge Admin";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:8102;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 2.4 发布流程（版本目录化）

```bash
# 1) 新版本落目录
rsync -a --delete admin/ /opt/shengge/releases/<新时间戳>/admin/
# 2) 切换并重启
ln -sfn /opt/shengge/releases/<新时间戳> /opt/shengge/current
sudo systemctl restart shengge-admin
# 3) 自动冒烟（看板 + 题库列表）
curl -sf http://127.0.0.1:8102/health || { ln -sfn /opt/shengge/releases/<旧时间戳> /opt/shengge/current; sudo systemctl restart shengge-admin; }
```

---

## 3. 备份与回滚方案

### 3.1 备份

管理后台与 App 后端**共享同一份 `db.json`**（含题库、热线、敏感词、审计日志），备份策略与 App 版完全一致：

- 每日 02:00 全量备份（见《生格-App运维部署文档-Linux版》§3.1 的 `backup.sh`，同机共用即可）
- 备份后必须做 JSON 完整性校验；本地 7 天 + 异地 30 天
- **审计日志 ≥6 个月留存**是合规硬要求：归档切片（如 `audit-YYYYMM.json`）在删除本地旧备份前，必须确认已异地归档

### 3.2 版本回滚（30 秒内完成）

```bash
ls -lt /opt/shengge/releases/ | head
ln -sfn /opt/shengge/releases/<旧版本目录> /opt/shengge/current
sudo systemctl restart shengge-admin
curl -sf http://127.0.0.1:8102/health   # 确认恢复
```

> 若新旧版本间数据 schema 有变更，回滚版本前先确认旧代码兼容当前 `db.json` 结构；必要时按 §3.3 同时回滚数据。

### 3.3 数据回滚（db.json 损坏/误操作时）

```bash
# ★ 关键：两服务共用 db.json，必须 app + admin 同时停止再恢复
sudo systemctl stop shengge-app shengge-admin
cp /opt/shengge/backups/db_<时间戳>.json /opt/shengge/server-data/db.json
node -e "JSON.parse(require('fs').readFileSync('/opt/shengge/server-data/db.json','utf8'))" && echo OK
sudo systemctl start shengge-app shengge-admin
# 验证三项：看板、热线、审计
curl -sf http://127.0.0.1:8102/api/admin/dashboard
curl -sf http://127.0.0.1:8101/api/v1/config/hotline
```

---

## 4. 常见问题排查

| 现象 | 排查命令 | 处置 |
|------|---------|------|
| 服务起不来 | `journalctl -u shengge-admin -n 50` | Node 版本 <18、端口占用、目录权限 |
| 端口被占 | `ss -lntp \| grep 8102` | kill 占用进程或改 `SG_PORT` |
| 后台页面打不开（公网） | 本身被 Nginx 白名单拒绝 | 预期行为；确认来源 IP 在 allow 列表 |
| 后台改了题库 App 未生效 | 无需重启！下发是即时读 | 检查 app 后端是否正常：`curl 127.0.0.1:8101/api/v1/config/questions` |
| 保存时报错/写入失败 | `tail -f /opt/shengge/logs/admin.err.log`、`df -h` | db.json 权限/磁盘满；确认属主 `shengge:shengge` |
| 热线替换被拦截 | — | 接口层强制"至少 1 条有效热线"，属内置保护，先新增再替换 |
| 审计日志缺失 | 检查 db.json 中 audit 段 | 从备份恢复；排查是否有越权删除（配合 §2.3 收紧访问） |
| 两服务数据不一致 | 确认两服务读的是同一份文件 | 检查两服务 `WorkingDirectory` 下的相对路径是否都指向 `/opt/shengge/server-data/` |
| 误操作下架/改错数据 | — | 小改：后台界面改回（有审计留痕）；大改：按 §3.3 数据回滚 |

### 日志位置

- 应用日志：`/opt/shengge/logs/admin.log`、`admin.err.log`（logrotate 配置见 App 版文档 §4）

---

## 5. 安全基线清单（上线前核对，后台权限敏感度高于 App 后端）

- [ ] 8102 不对公网；Nginx 白名单 + （可选）Basic Auth 已配置
- [ ] HTTPS 已启用，HTTP 强制跳转
- [ ] 后台登录使用强口令/独立账号（不要复用服务器密码）
- [ ] 审计日志 ≥6 个月留存且不可被后台删除路径触碰
- [ ] `secret.key` 权限 600，不进版本库
- [ ] 所有写操作会自动写审计日志——用真实账号操作，不留共享账号
- [ ] 备份 + 恢复演练已验证（重点演练"热线配置恢复"）
- [ ] 探针告警已覆盖 8102（含 `/api/admin/dashboard` 可用性）

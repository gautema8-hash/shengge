# 生格-App运维部署文档（Linux 版）

> 版本：v1.0 ｜ 适用：`app/backend`（Node.js ≥18，默认端口 8101）+ `app/frontend`
> 系统：Ubuntu 20.04+ / Debian / CentOS 8+（systemd 环境）

---

## 1. 快速启动指南（已有环境跳到 §2）

```bash
# 前置：Node.js >= 18
node -v || (curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs)

# 1) 取代码
sudo mkdir -p /opt/shengge && sudo chown $USER /opt/shengge
cd /opt/shengge
git clone <仓库地址> repo        # 或 scp/rsync 上传 app/、server-data/ 目录

# 2) 目录布局（推荐）
# /opt/shengge/
# ├── releases/<时间戳>/          # 每次发布一个目录
# ├── current -> releases/<最新>  # 软链，回滚靠它
# ├── server-data/                # db.json / secret.key / mysql-credentials.json
# └── logs/

# 3) 启动
ln -sfn /opt/shengge/releases/v1 /opt/shengge/current
cd /opt/shengge/current/app/backend
SG_PORT=8101 node server.js      # 前台验证

# 4) 验证
curl http://127.0.0.1:8101/health
curl http://127.0.0.1:8101/api/v1/config/hotline   # 热线下发必须非空
```

---

## 2. 标准部署步骤

### 2.1 环境要求

| 项 | 要求 |
|----|------|
| Node.js | ≥ 18（建议 20 LTS） |
| 端口 | 8101（可 `SG_PORT` 覆盖） |
| 目录 | `/opt/shengge/`，服务数据 `/opt/shengge/server-data/` |
| 用户 | 专用低权限用户 `shengge`（`sudo useradd -r -s /usr/sbin/nologin shengge`） |

### 2.2 systemd 服务配置

```ini
# /etc/systemd/system/shengge-app.service
[Unit]
Description=Shengge App Backend (port 8101)
After=network.target

[Service]
Type=simple
User=shengge
Group=shengge
WorkingDirectory=/opt/shengge/current/app/backend
Environment=SG_PORT=8101
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
# 内存保护：超过 300M 自动重启
Environment=NODE_OPTIONS=--max-old-space-size=256
StandardOutput=append:/opt/shengge/logs/app.log
StandardError=append:/opt/shengge/logs/app.err.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now shengge-app
sudo systemctl status shengge-app
```

### 2.3 数据目录与权限

```bash
sudo mkdir -p /opt/shengge/{server-data,logs}
sudo chown -R shengge:shengge /opt/shengge
# 关键：secret.key 限权
sudo chmod 600 /opt/shengge/server-data/secret.key
```

> 注意：代码通过相对路径 `../../server-data/db.json` 读取数据，因此 `server-data` 必须位于 `current` 的父级（即 `/opt/shengge/server-data`），与上面布局一致。

### 2.4 Nginx 反向代理（对外）

```nginx
server {
    listen 443 ssl http2;
    server_name api.shengge.example.com;
    ssl_certificate     /etc/letsencrypt/live/api.shengge.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.shengge.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8101;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

```bash
sudo certbot --nginx -d api.shengge.example.com   # 证书自动续期 certbot.timer
```

### 2.5 发布流程（版本目录化）

```bash
# 1) 新版本落目录
rsync -a --delete app/ /opt/shengge/releases/$(date +%Y%m%d%H%M)/app/
# 2) 冒烟验证后再切流量
ln -sfn /opt/shengge/releases/<新时间戳> /opt/shengge/current
sudo systemctl restart shengge-app
# 3) 自动冒烟
curl -sf http://127.0.0.1:8101/health || { echo "冒烟失败，立即回滚"; ln -sfn /opt/shengge/releases/<旧时间戳> /opt/shengge/current; sudo systemctl restart shengge-app; }
```

---

## 3. 备份与回滚方案

### 3.1 每日备份（cron）

```bash
#!/bin/bash
# /opt/shengge/scripts/backup.sh  —— crontab: 0 2 * * * /opt/shengge/scripts/backup.sh
set -euo pipefail
TS=$(date +%Y%m%d_%H%M%S)
DIR=/opt/shengge/backups
mkdir -p "$DIR"
cp /opt/shengge/server-data/db.json "$DIR/db_${TS}.json"
node -e "JSON.parse(require('fs').readFileSync('$DIR/db_${TS}.json','utf8'))" && echo "$TS backup ok" >> /opt/shengge/logs/backup.log
find "$DIR" -name 'db_*.json' -mtime +7 -delete        # 本地保留7天
# 异地：aws s3 cp / rclone copy 到对象存储，保留30天
```

### 3.2 版本回滚（30 秒内完成）

```bash
# 查看历史版本
ls -lt /opt/shengge/releases/ | head
# 切回上一版本并重启
ln -sfn /opt/shengge/releases/<旧版本目录> /opt/shengge/current
sudo systemctl restart shengge-app
curl -sf http://127.0.0.1:8101/health   # 确认恢复
```

### 3.3 数据回滚（db.json 损坏/误操作时）

```bash
sudo systemctl stop shengge-app shengge-admin    # 两服务共用 db.json，必须同停
cp /opt/shengge/backups/db_<时间戳>.json /opt/shengge/server-data/db.json
node -e "JSON.parse(require('fs').readFileSync('/opt/shengge/server-data/db.json','utf8'))" && echo OK
sudo systemctl start shengge-app shengge-admin
curl -sf http://127.0.0.1:8101/api/v1/config/hotline   # 确认热线数据完好
```

> ⚠️ 回滚数据会丢失备份点之后的增量（含审计日志），操作前先备份当前损坏文件留证。

---

## 4. 常见问题排查

| 现象 | 排查命令 | 处置 |
|------|---------|------|
| 服务起不来 | `journalctl -u shengge-app -n 50` | 多为 Node 版本 <18 或端口占用 |
| 端口被占 | `ss -lntp \| grep 8101` | `kill <pid>` 或改 `SG_PORT` |
| `db.json 写入失败 / EACCES` | `ls -l /opt/shengge/server-data/`、`df -h` | 修属主 `chown shengge:shengge`；清磁盘 |
| 题库/热线接口返回空 | 看管理后台是否误操作 | 接口层有"热线不可全下线"保护；若数据损坏按 §3.3 恢复 |
| 同步接口 5xx | `tail -f /opt/shengge/logs/app.err.log` | 多为 db.json JSON 损坏 → node JSON.parse 验证 + 回滚数据 |
| 内存持续上涨 | `systemctl status shengge-app`、`ps aux \| grep node` | systemd/守护会在超限时自动重启；根因排查连接未释放 |
| 重启后服务未自启 | `systemctl is-enabled shengge-app` | `systemctl enable shengge-app` |
| 证书过期 | `certbot certificates` | `certbot renew --force-renewal` |

### 日志位置

- 应用日志：`/opt/shengge/logs/app.log`、`app.err.log`
- 建议配置 logrotate：

```
# /etc/logrotate.d/shengge
/opt/shengge/logs/*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
}
```

---

## 5. 安全基线清单（上线前核对）

- [ ] SSH 禁密码、密钥登录
- [ ] 防火墙仅放行 22/80/443，8101/8102 不对公网（`ufw status`）
- [ ] `secret.key` 权限 600，不进版本库
- [ ] 服务以 `shengge` 低权限用户运行
- [ ] 备份 cron 已配置且做过一次恢复演练
- [ ] 探针告警（每 5 分钟）已接入通知渠道

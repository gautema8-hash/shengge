/**
 * 「生格」App 薄后端（Node.js >=18）· 真实数据环境版
 * MySQL 8.0 权威存储（SG_MYSQL=0 可降级 JSON）+ Redis 限流/缓存（可降级内存）
 * 契约：docs/生格-技术文档.md §5，前缀 /api/v1
 *
 * 隐私红线：无明文 L3 数据落库；sync_blob 双重加密（E2E + 服务端 AES-256-GCM）；
 * 审核不存原文不回显；敏感词 patterns 静态加密。
 *
 * 启动：NODE_PATH=<node_modules> node server.js（端口 8101）
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const G = require('./guard');
const cache = require('./cache');

const PORT = Number(process.env.SG_PORT || 8101);
// 前端目录优先级：--frontend 命令行参数 > SG_FRONTEND_DIR 环境变量 > 默认 ../frontend
const FRONTEND_DIR = (process.argv.find(a => a.startsWith('--frontend=')) || '').split('=')[1]
  || process.env.SG_FRONTEND_DIR || path.join(__dirname, '..', 'frontend');
const API_RATE = Number(process.env.SG_APP_RATE || 240);
const MOD_RATE = Number(process.env.SG_MOD_RATE || 60);
const BLOB_MAX = 512 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function ok(data, msg) { return JSON.stringify({ code: 0, msg: msg || 'ok', data }); }
function err(msg, code) { return JSON.stringify({ code: code || 1, msg, data: null }); }

const server = http.createServer(handler);

async function api(req, res, p) {
  const ip = G.clientIp(req);
  await store.refreshShared(); // 跨进程共享数据刷新（TTL 内跳过）

  if (p !== '/api/v1/health') {
    if (!(await G.rateLimit('app:' + ip, API_RATE, 60000))) return G.send(req, res, 429, err('请求过于频繁，请稍后再试', 429));
    if (p === '/api/v1/moderation/check' && !(await G.rateLimit('mod:' + ip, MOD_RATE, 60000))) return G.send(req, res, 429, err('操作太频繁了，先休息一下', 429));
  }

  const db = store.load();
  const body = req.method === 'POST' || req.method === 'PUT' ? await G.readBody(req, BLOB_MAX) : { data: {} };
  if (body.err === 'too_large') return G.send(req, res, 413, err('数据太大啦', 413));
  if (body.err === 'bad_json') return G.send(req, res, 400, err('请求格式有误', 400));
  const b = body.data || {};

  if (req.method === 'POST' && p === '/api/v1/auth/guest') {
    const id = store.nextId(db.users);
    const anon = 'a***' + String(1000 + Math.floor(Math.random() * 9000));
    db.users.push({ id, anonId: anon, registeredAt: new Date().toISOString().slice(5, 10), sync: '未开启', risk: '正常', account: '正常', note: '' });
    db.stats.totalUsers += 1; db.stats.weekNew += 1;
    await store.save();
    return G.send(req, res, 200, ok({ accountId: id, anonId: anon, token: 'guest-' + id }));
  }

  if (req.method === 'POST' && p === '/api/v1/sync/push') {
    const accountId = G.intOf(b.accountId, 0);
    const deviceId = G.str(b.deviceId, 64);
    const blob = G.str(b.blob, BLOB_MAX);
    if (!accountId || !deviceId || !blob) return G.send(req, res, 400, err('accountId/deviceId/blob 必填'));
    const rev = db.syncBlobs.filter(x => x.accountId === accountId).reduce((m, x) => Math.max(m, x.rev), 0) + 1;
    db.syncBlobs.push({ id: store.nextId(db.syncBlobs), accountId, deviceId, blob, rev, createdAt: new Date().toISOString() });
    if (db.syncBlobs.length > 50000) db.syncBlobs = db.syncBlobs.slice(-40000);
    await store.save();
    return G.send(req, res, 200, ok({ rev }));
  }
  if (req.method === 'POST' && p === '/api/v1/sync/pull') {
    const accountId = G.intOf(b.accountId, 0);
    const rev = G.intOf(b.rev, 0);
    if (!accountId) return G.send(req, res, 400, err('accountId 必填'));
    const rows = db.syncBlobs.filter(x => x.accountId === accountId && x.rev > rev).map(x => ({ deviceId: x.deviceId, blob: x.blob, rev: x.rev }));
    return G.send(req, res, 200, ok({ blobs: rows }));
  }

  if (req.method === 'GET' && p === '/api/v1/config/questions') {
    await store.refreshShared({ force: true }); // 配置为跨进程数据（admin 可改），读取强制对账
    return G.send(req, res, 200, ok(db.questions.filter(q => q.status === 'active').map(q => ({ id: q.id, content: q.content, category: q.category }))));
  }
  if (req.method === 'GET' && p === '/api/v1/config/hotline') {
    await store.refreshShared({ force: true });
    return G.send(req, res, 200, ok(db.hotlines.filter(h => h.status === 'valid').map(h => ({ region: h.region, name: h.name, phone: h.phone, hours: h.hours }))));
  }

  if (req.method === 'POST' && p === '/api/v1/moderation/check') {
    await store.refreshShared({ force: true }); // 词库可能被 admin 更新，审核前强制对账
    const text = G.str(b.text, 2000);
    const r = store.moderate(text);
    if (r.level >= 2) {
      const n = new Date();
      const t = `${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')} ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
      db.riskEvents.unshift({ id: store.nextId(db.riskEvents), time: t, level: 'L2 高危', lv: 2, category: r.category || '自伤类', action: '危机弹窗 + 热线转介', status: '已处理（端侧自动）' });
      if (db.riskEvents.length > 10000) db.riskEvents.length = 10000;
      db.stats.todayHighRisk += 1;
      await store.save();
    }
    return G.send(req, res, 200, ok({ level: r.level, action: r.level >= 2 ? 'show_crisis_modal' : r.level === 1 ? 'silent_observe' : 'none' }));
  }

  if (p === '/api/v1/health') {
    return G.send(req, res, 200, ok({ service: 'shengge-app-api', time: new Date().toISOString(), storage: store.getMode(), cache: cache.getMode(), encryption: store.getEncryptInfo() }));
  }
  return G.send(req, res, 404, err('not found', 404));
}

server.headersTimeout = 35000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 64;

async function handler(req, res) {
  req.socket.setTimeout(30000);
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (req.method === 'OPTIONS') return G.send(req, res, 204, '');
  try {
    if (p.startsWith('/api/')) return await api(req, res, p);
    if (p === '/ping') return G.send(req, res, 200, ok({ pong: Date.now() }));
    if (p === '/robots.txt') return G.send(req, res, 200, 'User-agent: *\nDisallow: /api/\n', 'text/plain');
    return G.serveStatic(req, res, p, FRONTEND_DIR, MIME);
  } catch (e) {
    console.error('[app-api][error]', p, e && e.message);
    if (!res.headersSent) return G.send(req, res, 500, err('服务暂时不可用，请稍后再试'));
  }
}

(async () => {
  const mode = await store.init();
  await cache.ensure(); // 启动即探测 Redis，health 上报准确
  // 双端口：http 恒在 PORT（桌面/常规）；配置 SG_TLS_CERT/SG_TLS_KEY 时额外开 https
  // （https 用途：真机浏览器访问——Chromium HTTPS-First 会把 http 升级为 https，必须提供 TLS 端口）
  const tlsCert = process.env.SG_TLS_CERT, tlsKey = process.env.SG_TLS_KEY;
  if (tlsCert && tlsKey) {
    const tlsPort = Number(process.env.SG_TLS_PORT || 8103);
    https.createServer({ cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) }, handler).listen(tlsPort, () => {
      console.log(`[shengge-app-api] https listening on 0.0.0.0:${tlsPort} (for mobile browsers)`);
    });
  }
  server.listen(PORT, () => {
    console.log(`[shengge-app-api] http listening on 0.0.0.0:${PORT} | storage=${mode} cache=${cache.getMode()} rate=${API_RATE}/min/ip`);
    console.log(`[shengge-app-api] frontend: ${FRONTEND_DIR}`);
    console.log(`[shengge-app-api] encryption: ${JSON.stringify(store.getEncryptInfo())}`);
  });
})().catch(e => { console.error('[app-api] 启动失败:', e.message); process.exit(1); });

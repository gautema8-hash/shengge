/**
 * 「生格」管理后台 API（Node.js >=18）· 真实数据环境版
 * MySQL 8.0 权威存储 + Redis 会话/限流。端口 8102（SG_PORT 覆盖）。
 *
 * 安全：登录鉴权（Redis 会话 8h）+ 防爆破锁定 + 全局限流 + 错误脱敏 + 审计留痕
 * 凭证：env SG_ADMIN_USER / SG_ADMIN_PASS（默认 admin / shengg@2026，生产必改）
 * 启动：NODE_PATH=<node_modules> node server.js
 */
'use strict';
const http = require('http');
const path = require('path');
const store = require('./store');
const G = require('./guard');
const cache = require('./cache');

const PORT = Number(process.env.SG_PORT || 8102);
const ADMIN_USER = process.env.SG_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SG_ADMIN_PASS || 'shengg@2026';
// 前端目录优先级：--frontend 命令行参数 > SG_FRONTEND_DIR 环境变量 > 默认 ../frontend
const FRONTEND_DIR = (process.argv.find(a => a.startsWith('--frontend=')) || '').split('=')[1]
  || process.env.SG_FRONTEND_DIR || path.join(__dirname, '..', 'frontend');
const ADMIN_RATE = Number(process.env.SG_ADMIN_RATE || 120);
const LOGIN_RATE = Number(process.env.SG_LOGIN_RATE || 10);
const BODY_MAX = 256 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function ok(data) { return JSON.stringify({ code: 0, msg: 'ok', data }); }
function err(msg, code) { return JSON.stringify({ code: code || 1, msg, data: null }); }

const server = http.createServer(async (req, res) => {
  req.socket.setTimeout(30000);
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (req.method === 'OPTIONS') return G.send(req, res, 204, '');
  try {
    if (p.startsWith('/api/admin/')) return await api(req, res, p);
    if (p === '/ping') return G.send(req, res, 200, ok({ pong: Date.now() }));
    if (p === '/robots.txt') return G.send(req, res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain');
    return G.serveStatic(req, res, p, FRONTEND_DIR, MIME);
  } catch (e) {
    console.error('[admin-api][error]', p, e && e.message);
    if (!res.headersSent) return G.send(req, res, 500, err('服务暂时不可用，请稍后再试'));
  }
});

async function api(req, res, p) {
  const ip = G.clientIp(req);
  await store.refreshShared(); // 跨进程共享数据刷新（TTL 内跳过）
  const db = store.load();

  if (req.method === 'POST' && p === '/api/admin/login') {
    if (!(await G.rateLimit('login:' + ip, LOGIN_RATE, 5 * 60000))) {
      await store.pushAudit('系统', '登录尝试被限流（疑似爆破）', 'ip ' + ip.replace(/^::ffff:/, ''), '已拦截');
      return G.send(req, res, 429, err('尝试过于频繁，请 5 分钟后再试', 429));
    }
    const body = await G.readBody(req, 4096);
    if (body.err) return G.send(req, res, 400, err('请求有误', 400));
    const user = G.str(body.data.username, 32), pass = G.str(body.data.password, 64);
    if (user !== ADMIN_USER || pass !== ADMIN_PASS) return G.send(req, res, 401, err('用户名或密码不正确', 401));
    const token = await G.issueToken(user);
    await store.pushAudit(user, '登录成功', '管理后台');
    return G.send(req, res, 200, ok({ token, user }));
  }

  if (p === '/api/admin/health') {
    if (!(await G.rateLimit('adm:' + ip, ADMIN_RATE, 60000))) return G.send(req, res, 429, err('请求过于频繁', 429));
    return G.send(req, res, 200, ok({ service: 'shengge-admin-api', time: new Date().toISOString(), storage: store.getMode(), cache: cache.getMode() }));
  }

  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await G.verifyToken(auth);
  if (!user) return G.send(req, res, 401, err('未登录或会话已过期', 401));

  if (!(await G.rateLimit('adm:' + ip, ADMIN_RATE, 60000))) return G.send(req, res, 429, err('请求过于频繁', 429));

  const body = req.method === 'POST' || req.method === 'PUT' ? await G.readBody(req, BODY_MAX) : { data: {} };
  if (body.err === 'too_large') return G.send(req, res, 413, err('数据太大', 413));
  if (body.err === 'bad_json') return G.send(req, res, 400, err('请求格式有误', 400));
  const b = body.data || {};
  const ACTOR = user;

  if (req.method === 'POST' && p === '/api/admin/logout') {
    await G.logout(auth);
    await store.pushAudit(ACTOR, '退出登录', '管理后台');
    return G.send(req, res, 200, ok({ bye: true }));
  }

  if (req.method === 'GET' && p === '/api/admin/dashboard') {
    await store.refreshShared({ force: true }); // KPI 含 App 端实时上报（风控计数等）
    return G.send(req, res, 200, ok({
      kpis: { totalUsers: db.stats.totalUsers, weekNew: db.stats.weekNew, northStar: db.stats.northStar, northStarDelta: db.stats.northStarDelta, crashRate: db.stats.crashRate, todayHighRisk: db.stats.todayHighRisk },
      weekly: db.stats.weekly,
      mood: db.stats.mood,
    }));
  }

  if (p === '/api/admin/questions') {
    if (req.method === 'GET') return G.send(req, res, 200, ok(db.questions));
    if (req.method === 'POST') {
      const content = G.str(b.content, 200);
      if (!content) return G.send(req, res, 400, err('content 必填'));
      const q = { id: store.nextId(db.questions), content, category: G.str(b.category, 32) || '感知当下', status: 'review', hits30d: 0 };
      db.questions.push(q);
      await store.save();
      await store.pushAudit(ACTOR, '题库新增（待复审）', `提问 #${q.id}`);
      return G.send(req, res, 200, ok(q));
    }
  }
  let m = p.match(/^\/api\/admin\/questions\/(\d+)$/);
  if (m && req.method === 'PUT') {
    const q = db.questions.find(x => x.id === +m[1]);
    if (!q) return G.send(req, res, 404, err('not found'));
    const before = q.status;
    if (b.content !== undefined) q.content = G.str(b.content, 200) || q.content;
    if (b.category !== undefined) q.category = G.str(b.category, 32);
    if (b.status !== undefined && ['active', 'review', 'offline'].includes(b.status)) q.status = b.status;
    await store.save();
    await store.pushAudit(ACTOR, before !== q.status ? `题库状态变更 ${before}→${q.status}` : '题库编辑', `提问 #${q.id}`);
    return G.send(req, res, 200, ok(q));
  }

  if (p === '/api/admin/hotlines') {
    if (req.method === 'GET') return G.send(req, res, 200, ok({ list: db.hotlines, lastCheck: '2026-10-01', nextCheck: '2027-01-01' }));
    if (req.method === 'POST') {
      const phone = G.str(b.phone, 32);
      if (!phone) return G.send(req, res, 400, err('phone 必填'));
      const h = { id: store.nextId(db.hotlines), region: G.str(b.region, 32) || '全国', name: G.str(b.name, 100) || '未命名热线', phone, hours: G.str(b.hours, 64) || '24 小时', status: 'valid', lastCheck: new Date().toISOString().slice(0, 10), nextCheck: '2027-01-01' };
      db.hotlines.push(h);
      await store.save();
      await store.pushAudit(ACTOR, '热线新增', h.phone);
      return G.send(req, res, 200, ok(h));
    }
  }
  m = p.match(/^\/api\/admin\/hotlines\/(\d+)$/);
  if (m && req.method === 'PUT') {
    const h = db.hotlines.find(x => x.id === +m[1]);
    if (!h) return G.send(req, res, 404, err('not found'));
    if (b.status === 'invalid') {
      const validLeft = db.hotlines.filter(x => x.status === 'valid' && x.id !== h.id).length;
      if (validLeft === 0) return G.send(req, res, 400, err('不可下线全部热线：至少保留 1 条有效配置'));
    }
    if (b.region !== undefined) h.region = G.str(b.region, 32) || h.region;
    if (b.name !== undefined) h.name = G.str(b.name, 100) || h.name;
    if (b.phone !== undefined) h.phone = G.str(b.phone, 32) || h.phone;
    if (b.hours !== undefined) h.hours = G.str(b.hours, 64) || h.hours;
    if (b.status !== undefined && ['valid', 'invalid'].includes(b.status)) h.status = b.status;
    await store.save();
    await store.pushAudit(ACTOR, '热线配置变更', h.phone);
    return G.send(req, res, 200, ok(h));
  }

  if (p === '/api/admin/words') {
    if (req.method === 'GET') return G.send(req, res, 200, ok(db.words.map(w => ({ id: w.id, masked: w.masked, level: w.level, levelLabel: w.levelLabel, category: w.category, response: w.response, status: w.status }))));
    if (req.method === 'POST') {
      const patterns = (Array.isArray(b.patterns) ? b.patterns : [b.patterns]).map(x => G.str(x, 32)).filter(Boolean);
      const level = G.intOf(b.level, 0);
      if (!patterns.length || ![1, 2].includes(level)) return G.send(req, res, 400, err('patterns/level 必填（level: 1|2）'));
      const raw = patterns[0];
      const masked = raw.length > 1 ? raw.slice(0, 1) + '***' + raw.slice(-1) : raw + '***';
      const w = { id: store.nextId(db.words), masked, level, levelLabel: level >= 2 ? '高危 L2' : '疑似 L1', category: G.str(b.category, 32) || '自伤类', response: level >= 2 ? '立即危机弹窗' : '静默观察计数', status: 'reviewing', patterns };
      db.words.push(w);
      await store.save();
      await store.pushAudit(ACTOR, `敏感词新增（L${level}）`, masked);
      return G.send(req, res, 200, ok({ id: w.id, masked: w.masked, levelLabel: w.levelLabel, status: w.status }));
    }
  }
  m = p.match(/^\/api\/admin\/words\/(\d+)$/);
  if (m && req.method === 'PUT') {
    const w = db.words.find(x => x.id === +m[1]);
    if (!w) return G.send(req, res, 404, err('not found'));
    if (b.status !== undefined && ['active', 'reviewing'].includes(b.status)) w.status = b.status;
    await store.save();
    await store.pushAudit(ACTOR, '敏感词复核', w.masked);
    return G.send(req, res, 200, ok({ id: w.id, masked: w.masked, status: w.status }));
  }
  if (req.method === 'POST' && p === '/api/admin/words/sync') {
    await store.pushAudit(ACTOR, '词库同步到端侧', `版本 rev-${Date.now() % 100000}`);
    return G.send(req, res, 200, ok({ synced: true, count: db.words.length }));
  }

  if (req.method === 'GET' && p === '/api/admin/risk') { await store.refreshShared({ force: true }); return G.send(req, res, 200, ok(db.riskEvents)); }
  if (req.method === 'GET' && p === '/api/admin/audit') { await store.refreshShared({ force: true }); return G.send(req, res, 200, ok(db.auditLogs)); }
  if (req.method === 'GET' && p === '/api/admin/users') { await store.refreshShared({ force: true }); return G.send(req, res, 200, ok(db.users)); }
  if (req.method === 'GET' && p === '/api/admin/questions') { await store.refreshShared({ force: true }); return G.send(req, res, 200, ok(db.questions)); }

  return G.send(req, res, 404, err('not found', 404));
}

server.headersTimeout = 35000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 64;

(async () => {
  const mode = await store.init();
  await cache.ensure();
  server.listen(PORT, () => {
    console.log(`[shengge-admin-api] listening on http://127.0.0.1:${PORT} | storage=${mode} cache=${cache.getMode()} rate=${ADMIN_RATE}/min/ip`);
    console.log(`[shengge-admin-api] frontend: ${FRONTEND_DIR}`);
    if (!process.env.SG_ADMIN_PASS) console.warn('[shengge-admin-api] ⚠ 正在使用默认密码，生产部署请设置 SG_ADMIN_USER / SG_ADMIN_PASS！');
  });
})().catch(e => { console.error('[admin-api] 启动失败:', e.message); process.exit(1); });

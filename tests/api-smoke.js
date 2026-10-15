/**
 * 「生格」全端自动化冒烟测试（零依赖，node >= 18）
 * 运行：node tests/api-smoke.js
 * 策略：以隔离端口(8111/8112)+隔离数据目录拉起两套后端 → 跑全部断言 → 清理。
 * 覆盖：App API 契约 / Admin API / 双后端共享数据一致性 / 隐私与安全红线 / 前端静态检查
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const APP_PORT = 8111, ADM_PORT = 8112;
const DATA_DIR = path.join(__dirname, '.tmp-data');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
function req(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
    const r = http.request({ host: '127.0.0.1', port, method: method || 'GET', path: p, headers }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, text: raw, json: (() => { try { return JSON.parse(raw); } catch (e) { return null; } })() }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
let TOKEN = '';
function waitHealth(port, ms) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      req(port, 'GET', '/ping').then(() => resolve()).catch(() => {
        if (Date.now() - t0 > ms) return reject(new Error('service ' + port + ' not ready'));
        setTimeout(poll, 200);
      });
    })();
  });
}

/* ── 静态检查：HTML onclick 处理函数必须在对应 JS 中定义 ── */
function staticChecks() {
  console.log('\n▶ 静态检查（前端）');
  const pairs = [
    ['app/frontend/index.html', 'app/frontend/app.js'],
    ['admin/frontend/index.html', 'admin/frontend/admin.js'],
  ];
  for (const [h, j] of pairs) {
    const html = fs.readFileSync(path.join(ROOT, h), 'utf8');
    const js = fs.readFileSync(path.join(ROOT, j), 'utf8');
    const fns = new Set();
    for (const m of html.matchAll(/onclick="([a-zA-Z_$][\w$]*)\s*\(/g)) fns.add(m[1]);
    const missing = [...fns].filter(f => !new RegExp(`function\\s+${f}\\b`).test(js) && !new RegExp(`const\\s+${f}\\s*=`).test(js));
    ok(`${h} 的 ${fns.size} 个 onclick 处理函数均已定义`, missing.length === 0, '缺失: ' + missing.join(', '));
    // 引用的本地资源存在
    for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const ref = m[1];
      if (/^https?:/.test(ref)) continue;
      ok(`${h} 引用的 ${ref} 存在`, fs.existsSync(path.join(ROOT, path.dirname(h), ref)));
    }
  }
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 真实数据库模式：重置测试库，保证确定性起点（与 delivery-real 同约定）
  if (process.env.NODE_PATH) {
    try {
      const mysql2 = require('mysql2/promise');
      const cred = JSON.parse(fs.readFileSync(path.join(ROOT, 'server-data', 'mysql-credentials.json'), 'utf8'));
      const c = await mysql2.createConnection({ host: cred.host, port: cred.port, user: 'root', password: process.env.SG_MYSQL_ROOT_PASS || 'root123!@#', database: 'shengge_test' });
      const [tables] = await c.query('SHOW TABLES');
      for (const t of tables) await c.query('DROP TABLE IF EXISTS `' + Object.values(t)[0] + '`');
      await c.end();
      console.log('  ✅ 测试库已重置（MySQL 模式）');
    } catch (e) { console.log('  ⚠ 测试库重置跳过：' + e.message); }
  }

  staticChecks();

  console.log('\n▶ 启动被测服务（隔离端口/数据目录）');
  const app = spawn(NODE, [path.join(ROOT, 'app/backend/server.js')], { env: { ...process.env, SG_PORT: String(APP_PORT), SG_DATA_DIR: DATA_DIR, SG_MYSQL_DB: 'shengge_test' }, stdio: 'ignore' });
  // dist 模式下，admin 服务应指向自己的 dist（App 的 dist 对它没有意义）
  const adminFeDir = process.env.SG_FRONTEND_DIR
    ? process.env.SG_FRONTEND_DIR.replace(/app[\\/]frontend[\\/]dist/, path.join('admin', 'frontend', 'dist'))
    : undefined;
  const adm = spawn(NODE, [path.join(ROOT, 'admin/backend/server.js')], { env: { ...process.env, SG_PORT: String(ADM_PORT), SG_DATA_DIR: DATA_DIR, SG_MYSQL_DB: 'shengge_test', ...(adminFeDir ? { SG_FRONTEND_DIR: adminFeDir } : {}) }, stdio: 'ignore' });
  try {
    await waitHealth(APP_PORT, 25000);
    await waitHealth(ADM_PORT, 25000);
    console.log('  ✅ 双服务就绪');

    // 管理后台登录（安全加固后需鉴权）
    let r = await req(ADM_PORT, 'POST', '/api/admin/login', { username: 'admin', password: 'shengg@2026' });
    ok('A0 管理后台登录获取会话令牌', r.json && r.json.code === 0 && r.json.data.token);
    TOKEN = r.json.data.token;

    /* ── App API ── */
    console.log('\n▶ App API（/api/v1）');
    r = await req(APP_PORT, 'GET', '/api/v1/health');
    ok('A1 health', r.json && r.json.code === 0 && r.json.data.service === 'shengge-app-api');

    r = await req(APP_PORT, 'GET', '/api/v1/config/questions');
    const qs = r.json && r.json.data;
    ok('A2 题库下发：数组且仅含上架项', Array.isArray(qs) && qs.length >= 5 && qs.every(q => q.content), `len=${qs && qs.length}`);

    r = await req(APP_PORT, 'GET', '/api/v1/config/hotline');
    const hs = r.json && r.json.data;
    ok('A3 热线下发：≥1 条且含 12356', Array.isArray(hs) && hs.length >= 1 && hs.some(h => h.phone === '12356'));

    const usersBefore = (await req(ADM_PORT, 'GET', '/api/admin/users')).json.data.length;
    r = await req(APP_PORT, 'POST', '/api/v1/auth/guest', {});
    ok('A4 游客账号：accountId/token/anonId 脱敏', r.json.code === 0 && r.json.data.token && /^a\*\*\*\d{4}$/.test(r.json.data.anonId));
    const usersAfter = (await req(ADM_PORT, 'GET', '/api/admin/users')).json.data.length;
    ok('A4b 游客注册 → 后台匿名用户列表 +1（共享数据）', usersAfter === usersBefore + 1, `${usersBefore}→${usersAfter}`);

    r = await req(APP_PORT, 'POST', '/api/v1/sync/push', { accountId: 999, deviceId: 'dev-t', blob: 'E2EBLOB-TEST' });
    const rev = r.json.data && r.json.data.rev;
    ok('A5 同步 push 返回 rev', r.json.code === 0 && rev >= 1);
    r = await req(APP_PORT, 'POST', '/api/v1/sync/pull', { accountId: 999, rev: 0 });
    ok('A5b pull 按 rev 拉到密文 blob', r.json.data.blobs.some(b => b.blob === 'E2EBLOB-TEST' && b.deviceId === 'dev-t'));
    r = await req(APP_PORT, 'POST', '/api/v1/sync/pull', { accountId: 999, rev: 99999 });
    ok('A5c pull 高 rev 返回空', r.json.data.blobs.length === 0);
    r = await req(APP_PORT, 'POST', '/api/v1/sync/push', { accountId: 1 });
    ok('A6 push 缺字段 → 400', r.status === 400);

    const dash0 = (await req(ADM_PORT, 'GET', '/api/admin/dashboard')).json.data;
    r = await req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: '今天天气很好，散步很舒服' });
    ok('A7 审核：安全文本 level 0', r.json.data.level === 0 && r.json.data.action === 'none');
    r = await req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: '感觉有点撑不下去了' });
    ok('A8 审核：L1 → 静默观察', r.json.data.level === 1 && r.json.data.action === 'silent_observe');
    const riskBefore = (await req(ADM_PORT, 'GET', '/api/admin/risk')).json.data.length;
    r = await req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: '真的不想活了' });
    ok('A9 审核：L2 → 危机弹窗转介', r.json.data.level === 2 && r.json.data.action === 'show_crisis_modal');
    ok('A9b L2 响应不含原文回显（仅 level/action）', Object.keys(r.json.data).sort().join(',') === 'action,level');
    const riskAfter = (await req(ADM_PORT, 'GET', '/api/admin/risk')).json.data;
    ok('A9c L2 → 风控事件留痕 +1（脱敏：无原文）', riskAfter.length === riskBefore + 1 && !JSON.stringify(riskAfter).includes('不想活'));
    const dash1 = (await req(ADM_PORT, 'GET', '/api/admin/dashboard')).json.data;
    ok('A9d L2 → 看板今日高危计数 +1（匿名聚合）', dash1.kpis.todayHighRisk === dash0.kpis.todayHighRisk + 1);

    r = await req(APP_PORT, 'GET', '/');
    ok('A10 App 前端由后端托管', r.status === 200 && r.text.includes('生命方格'));
    r = await req(APP_PORT, 'GET', '/api/v1/none');
    ok('A11 未知 API → 404', r.status === 404 && r.json.code === 404);
    r = await req(APP_PORT, 'GET', '/../server.js');
    ok('A12 路径穿越被拒', [403, 404].includes(r.status));

    /* ── Admin API ── */
    console.log('\n▶ Admin API（/api/admin）');
    r = await req(ADM_PORT, 'GET', '/api/admin/dashboard');
    const d = r.json.data;
    ok('B1 看板：KPI/7日/情绪分布 结构完整', d.kpis && d.weekly.length === 7 && ['nourish', 'drain', 'unlabeled'].every(k => k in d.mood));

    const auditBefore = (await req(ADM_PORT, 'GET', '/api/admin/audit')).json.data.length;
    r = await req(ADM_PORT, 'POST', '/api/admin/questions', { content: '测试提问：今天的晚霞是什么颜色？', category: '感知当下' });
    const newQ = r.json.data;
    ok('B2 新增提问默认"待复审"', newQ && newQ.status === 'review');
    r = await req(ADM_PORT, 'PUT', `/api/admin/questions/${newQ.id}`, { status: 'active' });
    ok('B2b 复核上架', r.json.data.status === 'active');
    r = await req(APP_PORT, 'GET', '/api/v1/config/questions');
    ok('B2c 上架后 App 端题库即时可见（双后端共享数据）', r.json.data.some(q => q.content.includes('晚霞')), );
    r = await req(ADM_PORT, 'PUT', `/api/admin/questions/${newQ.id}`, { status: 'offline' });
    ok('B2d 下架生效', r.json.data.status === 'offline');
    r = await req(APP_PORT, 'GET', '/api/v1/config/questions');
    ok('B2e 下架后 App 端不再下发', !r.json.data.some(q => q.content.includes('晚霞')));
    const auditAfter = (await req(ADM_PORT, 'GET', '/api/admin/audit')).json.data;
    ok('B2f 全部写操作留痕审计 ≥3 条', auditAfter.length >= auditBefore + 3, `${auditBefore}→${auditAfter.length}`);

    r = await req(ADM_PORT, 'GET', '/api/admin/hotlines');
    const hl = r.json.data.list;
    ok('B3 热线列表含核验日期', r.json.data.lastCheck && hl.length >= 3);
    r = await req(ADM_PORT, 'PUT', `/api/admin/hotlines/${hl.find(h => h.phone === '12356').id}`, { status: 'invalid' });
    ok('B3b 下线非最后一条有效热线：允许', r.json.code === 0);
    r = await req(ADM_PORT, 'PUT', `/api/admin/hotlines/${hl.find(h => h.phone === '010-82951332').id}`, { status: 'invalid' });
    ok('B3c 下线全部热线：被拦截（红线）', r.status === 400 && r.json.code === 1, JSON.stringify(r.json));
    await req(ADM_PORT, 'PUT', `/api/admin/hotlines/${hl.find(h => h.phone === '12356').id}`, { status: 'valid' });

    r = await req(ADM_PORT, 'GET', '/api/admin/words');
    ok('B4 词库脱敏展示（无明文 patterns）', r.json.data.length >= 3 && !JSON.stringify(r.json.data).includes('patterns'));
    r = await req(ADM_PORT, 'POST', '/api/admin/words', { patterns: ['测试词甲', '测试词乙'], level: 2, category: '自伤类' });
    ok('B4b 新增词条自动脱敏', r.json.data && /^\S\*\*\*\S$/.test(r.json.data.masked));
    r = await req(ADM_PORT, 'PUT', `/api/admin/words/${r.json.data.id}`, { status: 'active' });
    ok('B4c 词库复核通过', r.json.data.status === 'active');
    r = await req(ADM_PORT, 'POST', '/api/admin/words/sync', {});
    ok('B4d 同步到端侧', r.json.data.synced === true);
    r = await req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: '包含测试词甲的句子' });
    ok('B4e 新词即时参与端侧审核兜底（共享数据）', r.json.data.level === 2);

    r = await req(ADM_PORT, 'GET', '/api/admin/users');
    ok('B5 用户视图仅匿名 ID+状态', r.json.data.every(u => /^a\*\*\*\d{4}$|^a\*\*\*|^—$/.test(u.anonId)) && !JSON.stringify(r.json.data).toLowerCase().includes('diary'));

    r = await req(ADM_PORT, 'GET', '/');
    ok('B6 后台前端由 API 托管', r.status === 200 && r.text.includes('运营后台'));

    /* ── 汇总 ── */
    console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`);
    if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
  } finally {
    app.kill(); adm.kill();
    setTimeout(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {} }, 300);
  }
  process.exitCode = fail ? 1 : 0;
}
main().catch(e => { console.error('测试框架异常:', e); process.exitCode = 1; });

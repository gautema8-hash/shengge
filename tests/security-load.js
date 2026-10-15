/**
 * 「生格」交付级安全 + 负载测试（零依赖，node >= 18）
 * 运行：node tests/security-load.js
 * 覆盖：
 *  S  安全：鉴权/爆破锁定/限流/畸形包/超大包/注入载荷/安全头/路径穿越/敏感词明文泄露
 *  L  负载：300 并发混合流量、4 轮持续负载、内存稳定性（1000 顺序请求）
 *  R  限流单元测试（直接驱动 guard.rateLimit 滑动窗口）
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const APP_PORT = 8111, ADM_PORT = 8112, APP_RATE_PORT = 8113, ADM_RATE_PORT = 8114;
const DATA_DIR = path.join(__dirname, '.tmp-sec-data');
// 负载阶段放宽限流，让并发测试不被 429 干扰；限流行为由 S 组 + R 组专项验证
const LOOSE_ENV = { SG_APP_RATE: '1000000', SG_MOD_RATE: '1000000', SG_ADMIN_RATE: '1000000', SG_LOGIN_RATE: '1000000' };

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
function req(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    let dataBuf = null;
    if (body !== undefined && body !== null) dataBuf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const h = Object.assign({}, headers || {});
    if (dataBuf && !Buffer.isBuffer(body)) h['Content-Type'] = 'application/json';
    if (dataBuf) h['Content-Length'] = dataBuf.length; // 必须用字节长度（多字节字符 string.length 会错位）
    const r = http.request({ host: '127.0.0.1', port, method: method || 'GET', path: p, headers: h }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: raw, json: (() => { try { return JSON.parse(raw); } catch (e) { return null; } })() }));
    });
    r.on('error', reject);
    r.setTimeout(20000, () => { r.destroy(); reject(new Error('timeout')); });
    if (dataBuf) r.write(dataBuf);
    r.end();
  });
}
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

/* ── R. 限流单元测试（滑动窗口逻辑直测）── */
function rateLimitUnitTests() {
  console.log('\n▶ R. 限流单元测试（guard.rateLimit）');
  // 用子进程隔离：rateLimit 有全局 Map，直接 require 会与负载阶段共享
  const { fork } = require('child_process');
  const code = `
    const g = require(${JSON.stringify(path.join(ROOT, 'app/backend/guard.js'))});
    (async () => {
      let allow = 0, deny = 0;
      const key = 'u1-' + Date.now(); // 唯一键，防历史运行残留
      for (let i = 0; i < 10; i++) (await g.rateLimit(key, 5, 60000)) ? allow++ : deny++;
      console.log('RESULT ' + allow + ' ' + deny);
      // 窗口过期恢复：两次间隔超过窗口的调用都应放行
      const r1 = await g.rateLimit(key + '-w', 2, 30);
      setTimeout(async () => {
        const r2 = await g.rateLimit(key + '-w', 2, 30);
        console.log('RESULT2 ' + (r1 && r2));
        process.exit(0); // ioredis 连接会挂住事件循环，输出完显式退出
      }, 60);
    })();
  `;
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('close', () => {
      const m = out.match(/RESULT (\d+) (\d+)/);
      ok('R1 超限即拒：上限 5 → 前 5 放行 / 后 5 拒绝', m && +m[1] === 5 && +m[2] === 5, out.trim());
      const m2 = out.match(/RESULT2 (true|false)/);
      ok('R2 窗口过期后恢复放行', m2 && m2[1] === 'true', out.trim());
      resolve();
    });
  });
}

async function main() {
  await rateLimitUnitTests();

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // MySQL 模式：重置测试库（L3 等精确计数断言需要确定性起点）
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
  console.log('\n▶ 启动被测服务（宽松限流，负载阶段用）');
  const mk = (script, port) => spawn(NODE, [path.join(ROOT, script)], {
    env: Object.assign({}, process.env, LOOSE_ENV, { SG_PORT: String(port), SG_DATA_DIR: DATA_DIR, SG_MYSQL_DB: 'shengge_test' }), stdio: 'ignore',
  });
  const app = mk('app/backend/server.js', APP_PORT);
  const adm = mk('admin/backend/server.js', ADM_PORT);
  // 独立实例：默认限流，专测 429
  const appStrict = spawn(NODE, [path.join(ROOT, 'app/backend/server.js')], {
    env: Object.assign({}, process.env, { SG_PORT: String(APP_RATE_PORT), SG_DATA_DIR: path.join(DATA_DIR, 'strict'), SG_APP_RATE: '20', SG_MYSQL_DB: 'shengge_test' }), stdio: 'ignore',
  });
  const admStrict = spawn(NODE, [path.join(ROOT, 'admin/backend/server.js')], {
    env: Object.assign({}, process.env, { SG_PORT: String(ADM_RATE_PORT), SG_DATA_DIR: path.join(DATA_DIR, 'strict2'), SG_MYSQL_DB: 'shengge_test' }), stdio: 'ignore',
  });
  try {
    await waitHealth(APP_PORT, 25000);
    await waitHealth(ADM_PORT, 25000);
    await waitHealth(APP_RATE_PORT, 25000);
    await waitHealth(ADM_RATE_PORT, 25000);

    /* ── S. 安全测试 ── */
    console.log('\n▶ S. 安全测试');

    // S1 鉴权
    let r = await req(ADM_PORT, 'GET', '/api/admin/dashboard');
    ok('S1 无令牌访问管理 API → 401', r.status === 401 && r.json.code === 401);
    r = await req(ADM_PORT, 'GET', '/api/admin/dashboard', undefined, { Authorization: 'Bearer fake-token-abc' });
    ok('S1b 伪造令牌 → 401', r.status === 401);
    r = await req(ADM_PORT, 'POST', '/api/admin/login', { username: 'admin', password: 'wrong-pass' });
    ok('S1c 错误密码 → 401（不泄露哪个字段错）', r.status === 401 && r.json.msg === '用户名或密码不正确');
    r = await req(ADM_PORT, 'POST', '/api/admin/login', { username: 'admin', password: 'shengg@2026' });
    const TOKEN = r.json.data.token;
    ok('S1d 正确凭证 → 会话令牌', !!TOKEN);
    const AUTH = { Authorization: 'Bearer ' + TOKEN };

    // S2 登录防爆破（严格实例：LOGIN_RATE 默认 10/5min）
    let locked = false;
    for (let i = 0; i < 12; i++) {
      const rr = await req(ADM_RATE_PORT, 'POST', '/api/admin/login', { username: 'admin', password: 'x' + i });
      if (rr.status === 429) { locked = true; break; }
    }
    ok('S2 连续错误密码触发防爆破锁定(429)', locked);
    r = await req(ADM_RATE_PORT, 'GET', '/api/admin/health'); // 锁定期间服务仍存活（拒绝而非崩溃）
    ok('S2b 锁定后服务仍存活', [200, 429].includes(r.status));

    // S3 API 限流（严格实例 SG_APP_RATE=20；health 在服务端豁免限流，改测业务接口）
    let saw429 = false, lastStatus = 0;
    for (let i = 0; i < 30; i++) {
      const rr = await req(APP_RATE_PORT, 'GET', '/api/v1/config/questions');
      lastStatus = rr.status;
      if (rr.status === 429) { saw429 = true; break; }
    }
    ok('S3 超出 20 次/分/IP → 429', saw429, '最后状态 ' + lastStatus);

    // S4 畸形 JSON / 超大包
    ok('S4 空 body 容错', (await req(APP_PORT, 'POST', '/api/v1/moderation/check', undefined, { 'Content-Type': 'application/json' })).status === 200);
    {
      const rawBody = '{"text": BAD-JSON!!';
      const bad = await new Promise((resolve, reject) => {
        const rq = http.request({ host: '127.0.0.1', port: APP_PORT, method: 'POST', path: '/api/v1/moderation/check', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rawBody) } }, (res) => { let x = ''; res.on('data', c => x += c); res.on('end', () => resolve({ status: res.statusCode })); });
        rq.on('error', reject); rq.end(rawBody);
      });
      ok('S4b 畸形 JSON → 400 且服务存活', bad.status === 400, 'status ' + bad.status);
    }
    const big = Buffer.alloc(600 * 1024, 'a');
    r = await req(APP_PORT, 'POST', '/api/v1/sync/push', { accountId: 1, deviceId: 'd', blob: big.toString() });
    ok('S4c 512KB+ 超大 blob → 413 拒绝', r.status === 413);
    r = await req(APP_PORT, 'GET', '/api/v1/health');
    ok('S4d 超大包攻击后服务存活', r.status === 200);

    // S5 注入类载荷（无 SQL/无 eval，应原样安全处理）
    const payloads = ["'; DROP TABLE users; --", '<script>alert(1)</script>', '${process.exit(1)}', '__proto__', '{"$gt":""}', '../../etc/passwd', '正常文案🥲emoji'];
    let allOk = true;
    for (const t of payloads) {
      const rr = await req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: t });
      if (rr.status !== 200 || !rr.json || typeof rr.json.data.level !== 'number') { allOk = false; break; }
    }
    ok('S5 注入/XSS/原型污染载荷全部安全处理', allOk);
    r = await req(ADM_PORT, 'POST', '/api/admin/questions', { content: "<img src=x onerror=alert(1)>'; DROP TABLE daily_question;--" }, AUTH);
    ok('S5b 恶意题库内容被存储但长度截断且不执行（前端 esc 转义兜底）', r.status === 200 && r.json.data.content.length <= 200);

    // S6 安全响应头 + CSP
    r = await req(APP_PORT, 'GET', '/');
    ok('S6 安全头齐全', r.headers['x-content-type-options'] === 'nosniff' && r.headers['x-frame-options'] === 'DENY' && r.headers['referrer-policy'] === 'no-referrer');
    ok('S6b HTML 响应带 CSP 且禁嵌入', /frame-ancestors 'none'/.test(r.headers['content-security-policy'] || ''));
    ok('S6c 静态 HTML 可协商缓存、API 响应禁缓存', r.headers['cache-control'] === 'no-cache' && (await req(APP_PORT, 'GET', '/api/v1/health')).headers['cache-control'] === 'no-store');

    // S7 路径穿越 / 敏感文件
    let blocked = true;
    for (const p2 of ['/../server.js', '/..%2fserver.js', '/%2e%2e/server.js', '/../../store.js', '/.git/config']) {
      const rr = await req(APP_PORT, 'GET', p2);
      if (![403, 404, 400].includes(rr.status) || (rr.text && rr.text.includes('require('))) { blocked = false; break; }
    }
    ok('S7 路径穿越/敏感文件封堵（5 组探测）', blocked);
    r = await req(ADM_PORT, 'GET', '/api/admin/words', undefined, AUTH);
    ok('S7b 词库接口不泄露明文 patterns', !r.text.includes('patterns'));

    // S8 会话注销
    r = await req(ADM_PORT, 'POST', '/api/admin/logout', {}, AUTH);
    ok('S8a 登出成功', r.status === 200);
    r = await req(ADM_PORT, 'GET', '/api/admin/dashboard', undefined, AUTH);
    ok('S8b 登出后令牌立即失效', r.status === 401);

    /* ── L. 负载测试 ── */
    console.log('\n▶ L. 交付级负载测试');
    // 重新登录（S8 注销了）
    r = await req(ADM_PORT, 'POST', '/api/admin/login', { username: 'admin', password: 'shengg@2026' });
    const T2 = r.json.data.token;

    async function burst(n, mkReq) {
      const t0 = Date.now();
      const rs = await Promise.all(Array.from({ length: n }, mkReq));
      return { ms: Date.now() - t0, rs };
    }

    // L1 300 并发混合读流量
    const mix = [];
    for (let i = 0; i < 300; i++) {
      const k = i % 5;
      if (k === 0) mix.push(() => req(APP_PORT, 'GET', '/api/v1/config/questions'));
      else if (k === 1) mix.push(() => req(APP_PORT, 'GET', '/api/v1/config/hotline'));
      else if (k === 2) mix.push(() => req(ADM_PORT, 'GET', '/api/admin/dashboard', undefined, { Authorization: 'Bearer ' + T2 }));
      else if (k === 3) mix.push(() => req(APP_PORT, 'GET', '/'));
      else mix.push(() => req(APP_PORT, 'GET', '/app.css'));
    }
    const t1 = Date.now();
    const results = await Promise.all(mix.map(f => f()));
    const ms1 = Date.now() - t1;
    const bad1 = results.filter(x => x.status !== 200).length;
    ok(`L1 300 并发混合流量：0 失败，耗时 ${ms1}ms`, bad1 === 0, JSON.stringify(results.filter(x => x.status !== 200).slice(0, 3).map(x => x.status)));

    // L2 持续 4 轮 × 100 并发写读混合（带失败分类诊断）
    let allPass = true; let writeOk = 0;
    const failDist = {};
    for (let round = 0; round < 4; round++) {
      const jobs = [];
      const tags = [];
      const pushJob = (tag, p2) => { jobs.push(p2); tags.push(tag); };
      for (let i = 0; i < 25; i++) {
        pushJob('mod', req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: '并发负载测试第' + round + '轮第' + i + '条' }));
        pushJob('push', req(APP_PORT, 'POST', '/api/v1/sync/push', { accountId: 42, deviceId: 'load-' + round + '-' + i, blob: 'BLOB' + i }));
        pushJob('audit', req(ADM_PORT, 'GET', '/api/admin/audit', undefined, { Authorization: 'Bearer ' + T2 }));
        pushJob('qcfg', req(APP_PORT, 'GET', '/api/v1/config/questions'));
      }
      const rs = await Promise.all(jobs);
      rs.forEach((x, idx) => {
        if (x.status === 200) writeOk++;
        else { allPass = false; const key = tags[idx] + ':' + x.status; failDist[key] = (failDist[key] || 0) + 1; }
      });
    }
    ok('L2 4 轮 × 100 并发写读混合：0 失败（400 请求）', allPass, writeOk + '/400 ok' + (Object.keys(failDist).length ? ' 失败分布 ' + JSON.stringify(failDist) : ''));

    // L3 数据一致性：并发 push 后 pull 应完整可读
    r = await req(APP_PORT, 'POST', '/api/v1/sync/pull', { accountId: 42, rev: 0 });
    ok('L3 高并发写入后数据完整可拉取', r.json.data.blobs.length === 100, '实际 ' + r.json.data.blobs.length);

    // L4 内存/句柄稳定性：1000 顺序请求后仍健康
    let okCount = 0;
    for (let i = 0; i < 1000; i++) { const rr = await req(APP_PORT, 'GET', '/ping'); if (rr.status === 200) okCount++; }
    ok('L4 1000 顺序请求 100% 成功（无内存/句柄衰减迹象）', okCount === 1000, okCount + '/1000');
    r = await req(APP_PORT, 'GET', '/api/v1/health');
    ok('L4b 压测后健康检查通过', r.status === 200);

    // L5 gzip 生效
    r = await req(APP_PORT, 'GET', '/app.js', undefined, { 'Accept-Encoding': 'gzip' });
    ok('L5 静态资源 gzip 压缩生效', r.headers['content-encoding'] === 'gzip');

    console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`);
    if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
  } finally {
    app.kill(); adm.kill(); appStrict.kill(); admStrict.kill();
    setTimeout(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {} }, 300);
  }
  process.exitCode = fail ? 1 : 0;
}
main().catch(e => { console.error('测试框架异常:', e); process.exitCode = 1; });

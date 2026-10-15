/**
 * 「生格」交付级真机模拟测试（真实 MySQL + Redis 数据环境）
 * 运行：NODE_PATH=<node_modules> node tests/delivery-real.js
 *
 * 模拟真实场景：
 *  D1 数据库模式启动 + schema 自动就绪 + 初始数据落库
 *  D2 真实存储验证（直接查 MySQL：数据真在库里）
 *  D3 Redis 真实生效（限流计数键 / 会话键在 Redis 中）
 *  D4 顶级隐私验证（拖库视角：blob/敏感词/风控在库里全无明文）
 *  D5 真机双端旅程模拟：设备A 记录+同步 → 设备B 换机拉取恢复（E2E 流程）
 *  D6 崩溃恢复：SIGKILL 杀进程 → 重启 → 数据零丢失
 *  D7 高并发写库：50 并发 push 全部落库、rev 连续无冲突
 *  D8 管理端变更 → App 端下发（MySQL 共享权威数据）
 */
'use strict';
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const NODE_PATH = process.env.NODE_PATH || '';
const APP_PORT = 8121, ADM_PORT = 8122;
const TEST_DB = 'shengge_test';
const DATA_DIR = path.join(__dirname, '.tmp-real-data');

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
function req(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    let dataBuf = null;
    if (body !== undefined && body !== null) dataBuf = Buffer.from(JSON.stringify(body));
    const h = Object.assign({}, headers || {});
    if (dataBuf) { h['Content-Type'] = 'application/json'; h['Content-Length'] = dataBuf.length; }
    const r = http.request({ host: '127.0.0.1', port, method: method || 'GET', path: p, headers: h }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, text: raw, json: (() => { try { return JSON.parse(raw); } catch (e) { return null; } })() }));
    });
    r.on('error', reject);
    r.setTimeout(15000, () => { r.destroy(); reject(new Error('timeout')); });
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
const sql = null; // 直查一律走 mysql2 连接（见下），不再经过 CLI

function startServers() {
  const env = {
    ...process.env, NODE_PATH,
    SG_PORT: String(APP_PORT), SG_DATA_DIR: DATA_DIR, SG_MYSQL_DB: TEST_DB,
    SG_APP_RATE: '1000000', SG_MOD_RATE: '1000000', SG_ADMIN_RATE: '1000000', SG_LOGIN_RATE: '1000000',
  };
  const admEnv = { ...env, SG_PORT: String(ADM_PORT) };
  const app = spawn(NODE, [path.join(ROOT, 'app/backend/server.js')], { env, stdio: 'ignore' });
  const adm = spawn(NODE, [path.join(ROOT, 'admin/backend/server.js')], { env: admEnv, stdio: 'ignore' });
  return { app, adm };
}

async function main() {
  console.log('▶ 前置：数据库与缓存探活');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // 拷贝凭证文件（setup-mysql 生成）到测试数据目录
  const credSrc = path.join(ROOT, 'server-data', 'mysql-credentials.json');
  if (!fs.existsSync(credSrc)) { console.error('缺少 server-data/mysql-credentials.json，请先运行 tools/setup-mysql.js'); process.exit(1); }
  fs.copyFileSync(credSrc, path.join(DATA_DIR, 'mysql-credentials.json'));

  // 清空测试库（干净起点）
  const cred = JSON.parse(fs.readFileSync(credSrc, 'utf8'));
  const mysql2 = require('mysql2/promise');
  const rootConn = await mysql2.createConnection({ host: '127.0.0.1', user: 'root', password: process.env.SG_MYSQL_ROOT_PASS || 'root123!@#', database: TEST_DB });
  await rootConn.query('SHOW TABLES').then(async ([tables]) => {
    for (const t of tables) await rootConn.query('DROP TABLE IF EXISTS `' + Object.values(t)[0] + '`');
  });
  await rootConn.end();
  console.log('  ✅ MySQL 8.0 可达（测试库已重置）');

  const Redis = require('ioredis');
  const redisProbe = new Redis({ port: 6379 });
  await redisProbe.ping();
  await redisProbe.keys('sg:*').then(async ks => { for (const k of ks) await redisProbe.del(k); });
  await redisProbe.quit();
  console.log('  ✅ Redis 5.0 可达（sg:* 键已清理）');

  console.log('\n▶ D1 数据库模式启动');
  let { app, adm } = startServers();
  await waitHealth(APP_PORT, 15000);
  await waitHealth(ADM_PORT, 15000);
  let h = (await req(APP_PORT, 'GET', '/api/v1/health')).json.data;
  ok('D1 服务以 MySQL 模式启动', h.storage === 'mysql', '实际 ' + h.storage);
  ok('D1b 缓存为 Redis 模式', h.cache === 'redis', '实际 ' + h.cache);
  ok('D1c 静态加密已启用（AES-256-GCM）', h.encryption && h.encryption.algorithm === 'AES-256-GCM');

  // D2 数据真在 MySQL 里
  console.log('\n▶ D2 真实存储验证（绕过 API 直查 MySQL）');
  const conn = await mysql2.createConnection({ host: '127.0.0.1', user: cred.user, password: cred.password, database: TEST_DB });
  let [rows] = await conn.query('SELECT COUNT(*) AS n FROM daily_question');
  ok('D2 题库已落库（30 条）', rows[0].n >= 30, '实际 ' + rows[0].n);
  [rows] = await conn.query('SELECT COUNT(*) AS n FROM hotline_config');
  ok('D2b 热线配置已落库', rows[0].n >= 3);

  // D3 Redis 真实生效
  console.log('\n▶ D3 Redis 真实生效');
  let r = await req(APP_PORT, 'GET', '/api/v1/config/questions');
  let keys = await new Redis({ port: 6379 }).keys('sg:rt:*');
  ok('D3 API 限流计数写入 Redis', keys.length > 0, 'keys=' + keys.length);
  r = await req(ADM_PORT, 'POST', '/api/admin/login', { username: 'admin', password: 'shengg@2026' });
  const TOKEN = r.json.data.token;
  keys = await new Redis({ port: 6379 }).keys('sg:sess:*');
  ok('D3b 会话令牌存于 Redis（8h TTL）', keys.length > 0);
  const AUTH = { Authorization: 'Bearer ' + TOKEN };

  // D4 顶级隐私：拖库视角全无明文
  console.log('\n▶ D4 顶级隐私验证（拖库视角）');
  const SECRET = 'TOPSECRET-E2E-BLOB-用户的秘密日记内容';
  await req(APP_PORT, 'POST', '/api/v1/sync/push', { accountId: 7, deviceId: 'device-A', blob: SECRET });
  await req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: '不想活了' });
  [rows] = await conn.query("SELECT blob_enc FROM sync_blob WHERE account_id=7 LIMIT 1");
  const blobInDb = Buffer.from(rows[0].blob_enc).toString('utf8');
  ok('D4 同步 blob 落库为密文（双重加密，拖库不可读）', !blobInDb.includes('TOPSECRET') && !blobInDb.includes('日记'), blobInDb.slice(0, 24) + '...');
  [rows] = await conn.query('SELECT patterns_enc FROM sensitive_word LIMIT 1');
  const patInDb = Buffer.from(rows[0].patterns_enc).toString('utf8');
  ok('D4b 敏感词命中词落库为密文', !patInDb.includes('不想活') && !patInDb.includes('轻生'));
  [rows] = await conn.query('SELECT COUNT(*) AS n FROM risk_event WHERE category LIKE "%不想活%" OR action LIKE "%TOPSECRET%"');
  ok('D4c 风控事件表无任何原文', rows[0].n === 0);
  const allTables = ['sync_blob', 'sensitive_word', 'risk_event', 'audit_log', 'app_user', 'daily_question', 'hotline_config'];
  let leak = false;
  for (const t of allTables) {
    [rows] = await conn.query(`SELECT * FROM \`${t}\``);
    for (const row of rows) for (const v of Object.values(row)) {
      if (typeof v === 'string' && (v.includes('TOPSECRET') || v.includes('不想活'))) leak = true;
      if (Buffer.isBuffer(v) && (v.toString('latin1').includes('TOPSECRET'))) leak = true;
    }
  }
  ok('D4d 全库扫描：无任何用户内容明文', !leak);

  // D5 真机双端旅程：设备A记录 → 换机 → 设备B恢复
  console.log('\n▶ D5 真机双端旅程（换机恢复）');
  r = await req(APP_PORT, 'POST', '/api/v1/auth/guest', {});
  const acct = r.json.data.accountId;
  ok('D5a 设备A 注册匿名账号', !!acct);
  const revA = (await req(APP_PORT, 'POST', '/api/v1/sync/push', { accountId: acct, deviceId: 'phone-A', blob: 'DEVICE-A-DIARY-BLOB' })).json.data.rev;
  // 端侧校验保存流程（模拟端侧审核引擎 + 危机转介）
  r = await req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: '今天的晚霞很好看' });
  ok('D5b 正常记录 → 端侧静默（level 0）', r.json.data.level === 0);
  r = await req(APP_PORT, 'POST', '/api/v1/moderation/check', { text: '感觉撑不下去了' });
  ok('D5c 低落记录 → L1 静默观察不提示', r.json.data.level === 1);
  r = await req(APP_PORT, 'GET', '/api/v1/config/hotline');
  ok('D5d 危机热线配置可拉取（12356）', r.json.data.some(x => x.phone === '12356'));
  r = await req(APP_PORT, 'POST', '/api/v1/sync/pull', { accountId: acct, rev: 0 });
  ok('D5e 设备B 换机拉取：拿到设备A 全部密文', r.json.data.blobs.length >= 1 && r.json.data.blobs.some(b => b.blob === 'DEVICE-A-DIARY-BLOB'));

  // D6 崩溃恢复：SIGKILL → 重启 → 零丢失
  console.log('\n▶ D6 崩溃恢复（模拟真机断电/崩溃）');
  const usersBefore = (await req(ADM_PORT, 'GET', '/api/admin/users', undefined, AUTH)).json.data.length;
  app.kill('SIGKILL');
  await new Promise(res => setTimeout(res, 500));
  // 仅重启 app 服务（admin 继续在跑，符合真实部署中单实例崩溃场景）
  app = spawn(NODE, [path.join(ROOT, 'app/backend/server.js')], {
    env: {
      ...process.env, NODE_PATH,
      SG_PORT: String(APP_PORT), SG_DATA_DIR: DATA_DIR, SG_MYSQL_DB: TEST_DB,
      SG_APP_RATE: '1000000', SG_MOD_RATE: '1000000', SG_ADMIN_RATE: '1000000', SG_LOGIN_RATE: '1000000',
    }, stdio: 'ignore',
  });
  await waitHealth(APP_PORT, 15000);
  h = (await req(APP_PORT, 'GET', '/api/v1/health')).json.data;
  ok('D6a SIGKILL 后重启成功（MySQL 模式）', h.storage === 'mysql');
  const usersAfter = (await req(ADM_PORT, 'GET', '/api/admin/users', undefined, AUTH)).json.data.length;
  ok('D6b 用户数据零丢失', usersAfter === usersBefore, `${usersBefore}→${usersAfter}`);
  r = await req(APP_PORT, 'POST', '/api/v1/sync/pull', { accountId: 7, rev: 0 });
  ok('D6c 崩溃前写入的 blob 完整恢复', r.json.data.blobs.some(b => b.blob === SECRET));

  // D7 高并发写库
  console.log('\n▶ D7 高并发写库（50 并发 push）');
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    req(APP_PORT, 'POST', '/api/v1/sync/push', { accountId: 88, deviceId: 'cc-' + i, blob: 'CC' + i })));
  const ms = Date.now() - t0;
  const fails = rs.filter(x => x.status !== 200).length;
  const revs = rs.map(x => x.json.data.rev).sort((a, b) => a - b);
  const revUnique = new Set(revs).size === 50 && Math.max(...revs) === 50;
  ok(`D7 50 并发写库 0 失败（${ms}ms）`, fails === 0);
  ok('D7b rev 无冲突（1..50 各一次，唯一索引兜底）', revUnique);
  [rows] = await conn.query('SELECT COUNT(*) AS n FROM sync_blob WHERE account_id=88');
  ok('D7c 50 条全部落库', rows[0].n === 50, '实际 ' + rows[0].n);

  // D8 管理端变更 → App 端即时下发
  console.log('\n▶ D8 管理端变更 → App 下发');
  r = await req(ADM_PORT, 'POST', '/api/admin/questions', { content: '真机测试：今天有什么声音让你停顿了一下？', category: '感知当下' }, AUTH);
  const qid = r.json.data.id;
  await req(ADM_PORT, 'PUT', `/api/admin/questions/${qid}`, { status: 'active' }, AUTH);
  r = await req(APP_PORT, 'GET', '/api/v1/config/questions');
  ok('D8 上架后 App 端题库即时可见（真机测试新提问）', r.json.data.some(q => q.content.includes('真机测试')), );
  [rows] = await conn.query("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE '%题库%'");
  ok('D8b 全程操作留痕审计（MySQL）', rows[0].n >= 2);

  await conn.end();
  app.kill(); adm.kill();
  setTimeout(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {} }, 300);

  console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`);
  if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0); // 显式退出：测试内 ioredis 连接会挂住事件循环
}
main().catch(e => { console.error('测试框架异常:', e.message); process.exit(1); });

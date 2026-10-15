/**
 * 「生格」数据层 v2：MySQL 8.0 权威存储（真实数据环境） + JSON 文件降级
 *
 * 模式：
 *  - mysql（默认）：内存镜像 + 写穿透持久化（append-only 表按 id 增量、小表全量 REPLACE）
 *  - json（SG_MYSQL=0 或 MySQL 不可达）：原 server-data/db.json
 *
 * 顶级隐私实现：
 *  - 数据库中不存在日记明文表、用户画像表（schema 级事实）
 *  - sync_blob 双重加密：端到端密文 → 服务端 AES-256-GCM 静态加密 → 落库（拖库也无法读）
 *  - 敏感词 patterns AES-256-GCM 静态加密（防拖库逆向危机检测规则）
 *  - 主密钥：env SG_MASTER_KEY 或 server-data/secret.key（自动生成，gitignore）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbmysql = require('./db');

const DATA_DIR = process.env.SG_DATA_DIR || path.join(__dirname, '..', '..', 'server-data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
// 主密钥与"数据"同生命周期（固定在仓库级 server-data），不随 SG_DATA_DIR 变化——
// 否则测试临时目录每次生成新密钥，历史密文将永久不可解
const KEY_FILE = process.env.SG_MASTER_KEY_FILE || path.join(__dirname, '..', '..', 'server-data', 'secret.key');

let MODE = 'json';          // 'mysql' | 'json'
let maxPersisted = {};      // append-only 表的已持久化最大 id

/* ── 静态加密（AES-256-GCM）── */
function masterKey() {
  if (process.env.SG_MASTER_KEY) return Buffer.from(process.env.SG_MASTER_KEY, 'hex');
  try { return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8'), 'hex'); }
  catch (e) {
    const k = crypto.randomBytes(32);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(KEY_FILE, k.toString('hex'), { mode: 0o600 });
    return k;
  }
}
const KEY = masterKey();
function enc(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function dec(buf) {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    const iv = b.slice(0, 12), tag = b.slice(12, 28), ct = b.slice(28);
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch (e) { return ''; }
}

/* ── 种子数据（与原型演示一致）── */
function seed() {
  const q = (content, category, status, hits) => ({ id: 0, content, category, status, hits30d: hits });
  const questions = [
    q('今天哪一刻，你觉得活着还不错？', '感知当下', 'active', 3412),
    q('最近什么事在消耗你？', '消耗与滋养', 'active', 2988),
    q('如果把今天的疲惫画成天气，是什么天气？', '消耗与滋养', 'active', 1204),
    q('你上一次大笑是什么时候，因为什么？', '回忆与意义', 'review', 986),
    q('（示例）你为什么还不努力？', '', 'offline', 0),
  ];
  const more = [
    '今天有没有一件小事，做得比想象中顺利？', '此刻窗外的光线是什么样子的？',
    '今天身体哪个部位在提醒你它的存在？', '今天有什么声音让你停顿了一下？',
    '如果今天是一道菜，它是什么味道？', '今天你为自己做了一件什么小事？',
    '最近有没有什么念头，反复出现？', '今天哪个瞬间你想慢下来？',
    '有什么东西今天被你顺手放好了？', '今天有没有想多看一眼的画面？',
    '今天说过的哪句话，你现在还想起来？', '今天最安静的十五分钟，你在做什么？',
    '最近什么事滋养了你？', '今天走路的时候，你在想什么？',
    '有没有一件小事，你今天决定不做了？', '今天接触到的温度，哪一种让你舒服？',
    '今天有没有一次很自然的呼吸放松？', '最近的傍晚，你都在哪里度过？',
    '今天有没有遇到一个让你温和的人或动物？', '如果给今天起一个名字，它叫什么？',
    '今天什么东西用完了？你注意到它了吗？', '有没有一句听到的话，想留下来？',
    '今天的疲惫落在身体的哪里？', '今天有没有比昨天多知道了一点点什么？',
    '最近一次觉得"这样就好"是什么时候？',
  ];
  more.forEach((c, i) => questions.push(q(c, '感知当下', 'active', 200 + ((i * 37) % 600))));
  questions.forEach((x, i) => (x.id = i + 1));

  const hotlines = [
    { id: 1, region: '全国', name: '心理援助热线', phone: '12356', hours: '24 小时', status: 'valid', lastCheck: '2026-10-01', nextCheck: '2027-01-01' },
    { id: 2, region: '北京', name: '心理危机干预中心', phone: '010-82951332', hours: '24 小时', status: 'valid', lastCheck: '2026-10-01', nextCheck: '2027-01-01' },
    { id: 3, region: '示例', name: '（示例热线）', phone: '000-0000', hours: '—', status: 'invalid', lastCheck: '2026-10-01', nextCheck: '2027-01-01' },
  ];
  // patterns 仅内存明文使用；持久化时静态加密（含 JSON 模式）
  const words = [
    { id: 1, masked: 'w***1', level: 2, levelLabel: '高危 L2', category: '自伤类', response: '立即危机弹窗', status: 'active', patterns: ['不想活', '轻生', '了结'] },
    { id: 2, masked: 'w***7', level: 2, levelLabel: '高危 L2', category: '自伤类', response: '立即危机弹窗', status: 'active', patterns: ['活着没意思', '消失算了'] },
    { id: 3, masked: 'p***3', level: 1, levelLabel: '疑似 L1', category: '绝望情绪类', response: '静默观察计数', status: 'reviewing', patterns: ['撑不下去', '好累啊', '没有意义'] },
  ];
  const riskEvents = [
    { id: 1, time: '10-16 00:12', level: 'L2 高危', lv: 2, category: '自伤类', action: '危机弹窗 + 热线转介', status: '已处理（端侧自动）' },
    { id: 2, time: '10-15 23:41', level: 'L2 高危', lv: 2, category: '自伤类', action: '危机弹窗 + 热线转介', status: '已处理（端侧自动）' },
    { id: 3, time: '10-15 22:07', level: 'L1 疑似', lv: 1, category: '绝望情绪类', action: '静默观察计数', status: '观察中' },
    { id: 4, time: '10-15 21:55', level: 'L1 疑似', lv: 1, category: '绝望情绪类', action: '静默观察计数', status: '观察中' },
  ];
  const auditLogs = [
    { id: 1, time: '10-15 18:20', actor: '运营员 A', action: '题库下架（违反文案宪法）', object: '提问 #E-0902', result: '成功 · 复核人 B' },
    { id: 2, time: '10-15 18:19', actor: '运营员 B', action: '复核通过（下架）', object: '提问 #E-0902', result: '成功' },
    { id: 3, time: '10-14 09:03', actor: '系统', action: '季度热线核验提醒', object: 'hotline_config', result: '已推送' },
    { id: 4, time: '10-12 14:47', actor: '运营员 A', action: '敏感词新增（L1）', object: 'p***3', result: '成功 · 复核人 C' },
  ];
  const users = [
    { id: 1, anonId: 'a***4821', registeredAt: '10-01', sync: '未开启', risk: '正常', account: '正常', note: '' },
    { id: 2, anonId: 'a***7702', registeredAt: '10-03', sync: '已开启', risk: '正常', account: '正常', note: '' },
    { id: 3, anonId: 'a***0093', registeredAt: '09-28', sync: '未开启', risk: 'L2 曾命中', account: '正常', note: '' },
    { id: 4, anonId: 'a***1145', registeredAt: '09-15', sync: '—', risk: '—', account: '注销中 · 余 9 天', note: '注销触发 15 天后物理删除' },
  ];
  return {
    questions, hotlines, words, riskEvents, auditLogs, users, syncBlobs: [],
    stats: {
      totalUsers: 1284, weekNew: 212, northStar: 37.2, northStarDelta: 2.1,
      crashRate: 0.18, todayHighRisk: 6,
      weekly: [52, 61, 48, 74, 88, 100, 70],
      mood: { nourish: 61, drain: 24, unlabeled: 15 },
    },
  };
}

let db = null;

/* ── JSON 模式（降级）── 命中词同样静态加密，磁盘上永不出现明文 */
function jsonRead() {
  try {
    const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (j.words) j.words = j.words.map(w => ({
      ...w,
      patterns: w.patterns_enc ? JSON.parse(dec(w.patterns_enc) || '[]') : (w.patterns || []),
      patterns_enc: undefined,
    }));
    return j;
  } catch (e) { return null; }
}
function jsonWrite() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = { ...db, words: (db.words || []).map(w => ({ ...w, patterns: undefined, patterns_enc: enc(JSON.stringify(w.patterns || [])) })) };
  fs.writeFileSync(DB_FILE, JSON.stringify(out, null, 2), 'utf8');
}

/* ── MySQL 模式 ── */
async function loadAllFromMySQL() {
  const out = seed();
  const qs = await dbmysql.query('SELECT id,content,category,status,hits30d FROM daily_question ORDER BY id');
  if (qs.length) out.questions = qs;
  const hs = await dbmysql.query('SELECT id,region,name,phone,hours,status,last_check AS lastCheck,next_check AS nextCheck FROM hotline_config ORDER BY id');
  if (hs.length) out.hotlines = hs;
  const ws = await dbmysql.query('SELECT id,masked,level,level_label AS levelLabel,category,response,status,patterns_enc FROM sensitive_word ORDER BY id');
  if (ws.length) out.words = ws.map(w => ({ id: w.id, masked: w.masked, level: w.level, levelLabel: w.levelLabel, category: w.category, response: w.response, status: w.status, patterns: JSON.parse(dec(w.patterns_enc) || '[]') }));
  const rs = await dbmysql.query('SELECT id,time,level,lv,category,action,status FROM risk_event ORDER BY id DESC');
  if (rs.length) out.riskEvents = rs;
  const als = await dbmysql.query('SELECT id,time,actor,action,object,result FROM audit_log ORDER BY id DESC');
  if (als.length) out.auditLogs = als;
  const us = await dbmysql.query('SELECT id,anon_id AS anonId,registered_at AS registeredAt,sync,risk,account,note FROM app_user ORDER BY id');
  if (us.length) out.users = us;
  const bs = await dbmysql.query('SELECT id,account_id AS accountId,device_id AS deviceId,blob_enc,rev FROM sync_blob ORDER BY id');
  if (bs.length) out.syncBlobs = bs.map(b => ({ id: b.id, accountId: b.accountId, deviceId: b.deviceId, blob: dec(b.blob_enc), rev: b.rev }));
  const kv = await dbmysql.query("SELECT v FROM kv WHERE k='stats'");
  if (kv.length) out.stats = typeof kv[0].v === 'string' ? JSON.parse(kv[0].v) : kv[0].v;
  return out;
}

async function persistToMySQL() {
  // append-only：syncBlobs / auditLogs / riskEvents 按 id 增量插入
  for (const [key, table] of [['syncBlobs', 'sync_blob'], ['auditLogs', 'audit_log'], ['riskEvents', 'risk_event']]) {
    const rows = db[key];
    const maxId = rows.reduce((m, x) => Math.max(m, x.id || 0), 0);
    const last = maxPersisted[table] || 0;
    const fresh = rows.filter(x => (x.id || 0) > last);
    if (table === 'sync_blob') {
      for (const b of fresh) {
        await dbmysql.query('INSERT INTO sync_blob (account_id,device_id,blob_enc,rev) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE device_id=VALUES(device_id)', [b.accountId, b.deviceId, enc(b.blob), b.rev]);
      }
    } else if (table === 'audit_log') {
      for (const a of fresh) await dbmysql.query('INSERT INTO audit_log (time,actor,action,object,result) VALUES (?,?,?,?,?)', [a.time, a.actor, a.action, a.object, a.result]);
    } else {
      for (const r of fresh) await dbmysql.query('INSERT INTO risk_event (time,level,lv,category,action,status) VALUES (?,?,?,?,?,?)', [r.time, r.level, r.lv, r.category, r.action, r.status]);
    }
    maxPersisted[table] = maxId;
  }
  // 小表全量 REPLACE（可变集合，行数小）
  await dbmysql.query('DELETE FROM daily_question');
  for (const q of db.questions) await dbmysql.query('INSERT INTO daily_question (id,content,category,status,hits30d) VALUES (?,?,?,?,?)', [q.id, q.content, q.category, q.status, q.hits30d || 0]);
  await dbmysql.query('DELETE FROM hotline_config');
  for (const h of db.hotlines) await dbmysql.query('INSERT INTO hotline_config (id,region,name,phone,hours,status,last_check,next_check) VALUES (?,?,?,?,?,?,?,?)', [h.id, h.region, h.name, h.phone, h.hours, h.status, h.lastCheck || '', h.nextCheck || '']);
  await dbmysql.query('DELETE FROM sensitive_word');
  for (const w of db.words) await dbmysql.query('INSERT INTO sensitive_word (id,masked,level,level_label,category,response,status,patterns_enc) VALUES (?,?,?,?,?,?,?,?)', [w.id, w.masked, w.level, w.levelLabel, w.category, w.response, w.status, enc(JSON.stringify(w.patterns || []))]);
  await dbmysql.query('DELETE FROM app_user');
  for (const u of db.users) await dbmysql.query('INSERT INTO app_user (id,anon_id,registered_at,sync,risk,account,note) VALUES (?,?,?,?,?,?,?)', [u.id, u.anonId, u.registeredAt, u.sync, u.risk, u.account, u.note || '']);
  await dbmysql.query("REPLACE INTO kv (k,v) VALUES ('stats',?)", [JSON.stringify(db.stats)]);
}

/* ── 初始化：尝试 MySQL，失败降级 JSON ── */
async function init() {
  if (process.env.SG_MYSQL === '0') { db = jsonRead() || seed(); jsonWrite(); MODE = 'json'; return MODE; }
  try {
    const r = await dbmysql.connect(process.env.SG_MYSQL_DB);
    // 顾问锁：app/admin 双进程并发首启时串行化"判空→播种"，防止双双播种造成
    // 主键冲突（一方 init 整体失败降级 JSON，共享数据从此分裂）
    const lockConn = await r.pool.getConnection();
    try {
      // 注意：lock 是 MySQL 8 保留字，别名不可用 AS lock
      const [[{ glock }]] = await lockConn.query("SELECT GET_LOCK('shengge_init', 20) AS glock");
      if (glock !== 1) throw new Error('获取初始化锁超时');
      try {
        const empty = await dbmysql.query('SELECT (SELECT COUNT(*) FROM daily_question)+(SELECT COUNT(*) FROM hotline_config)+(SELECT COUNT(*) FROM app_user) AS n');
        if (empty[0].n === 0) {
          // 首次运行：优先迁移既有 JSON 数据，否则种子
          const legacy = jsonRead();
          db = (legacy && legacy.questions && legacy.questions.length) ? legacy : seed();
          maxPersisted = {};
          await persistToMySQL();
          console.log('[store] MySQL 首次初始化：已写入初始数据（' + (legacy ? '迁移自 JSON' : '种子') + '）');
        } else {
          db = await loadAllFromMySQL();
          maxPersisted = {
            'sync_blob': db.syncBlobs.reduce((m, x) => Math.max(m, x.id || 0), 0),
            'audit_log': db.auditLogs.reduce((m, x) => Math.max(m, x.id || 0), 0),
            'risk_event': db.riskEvents.reduce((m, x) => Math.max(m, x.id || 0), 0),
          };
        }
      } finally {
        await lockConn.query("SELECT RELEASE_LOCK('shengge_init')");
      }
    } finally {
      lockConn.release();
    }
    MODE = 'mysql';
    return MODE;
  } catch (e) {
    console.warn('[store] ⚠ MySQL 不可达（' + e.message + '），降级 JSON 文件模式');
    db = jsonRead() || seed();
    jsonWrite();
    MODE = 'json';
    return MODE;
  }
}

/* 每次 API 调用从内存镜像读取（单进程权威）。原地返回同一引用，外部修改直接生效。 */
function load() {
  if (!db) db = jsonRead() || seed();
  return db;
}

/* ── 跨进程共享数据刷新（app 与 admin 双进程共用一份库）──
   每次请求入口调用：1.5s TTL 内直接跳过；有未落盘写入时以内存为准不回灌。 */

let lastRefresh = 0;
let pendingWrites = 0;

function copyInto(dst, src) { dst.length = 0; for (const x of src) dst.push(x); }

async function reloadSharedInPlace() {
  if (MODE === 'mysql') {
    const fresh = await loadAllFromMySQL();
    copyInto(db.questions, fresh.questions);
    copyInto(db.hotlines, fresh.hotlines);
    copyInto(db.words, fresh.words);
    copyInto(db.users, fresh.users);
    copyInto(db.riskEvents, fresh.riskEvents);
    copyInto(db.auditLogs, fresh.auditLogs);
    Object.assign(db.stats, fresh.stats);
  } else {
    const fresh = jsonRead();
    if (!fresh) return;
    copyInto(db.questions, fresh.questions || []);
    copyInto(db.hotlines, fresh.hotlines || []);
    copyInto(db.words, fresh.words || []);
    copyInto(db.users, fresh.users || []);
    copyInto(db.riskEvents, fresh.riskEvents || []);
    copyInto(db.auditLogs, fresh.auditLogs || []);
    Object.assign(db.stats, fresh.stats || {});
  }
}

let refreshing = false;
function refreshShared(opts) {
  const force = opts && opts.force;
  if (!force && (refreshing || Date.now() - lastRefresh < 1500)) return Promise.resolve();
  if (force) {
    // 跨进程敏感读（配置/词库/用户等）：绕过 TTL 强制对账；
    // 本进程有未落盘写入时跳过（内存比库新，回灌会丢数据）
    if (pendingWrites > 0) return Promise.resolve();
    return reloadSharedInPlace().catch(e => console.error('[store] 强制刷新失败（沿用内存）:', e.message));
  }
  refreshing = true;
  const p = (async () => {
    try {
      if (pendingWrites > 0) { lastRefresh = Date.now(); return; }
      await reloadSharedInPlace();
      lastRefresh = Date.now();
    } finally { refreshing = false; }
  })();
  p.catch(e => console.error('[store] 共享数据刷新失败（沿用内存）:', e.message));
  return p;
}

/* ── 写穿透持久化（串行队列）：并发请求的 save 排队执行，杜绝 DELETE/INSERT 交错锁冲突；
      调用方 await 到"自己产生的变更已落盘"才返回 ── */
let saveChain = Promise.resolve();
function save() {
  pendingWrites++;
  const p = saveChain.then(async () => {
    if (MODE === 'mysql') await persistToMySQL();
    else jsonWrite();
    pendingWrites = Math.max(0, pendingWrites - 1);
  });
  saveChain = p.catch(e => { pendingWrites = Math.max(0, pendingWrites - 1); console.error('[store] 持久化失败（内存数据不受影响，下个写请求重试）:', e.message); });
  return p;
}

function nextId(arr) { return arr.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1; }

async function pushAudit(actor, action, object, result) {
  const d = load();
  const now = new Date();
  const t = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  d.auditLogs.unshift({ id: nextId(d.auditLogs), time: t, actor, action, object, result: result || '成功' });
  await save();
}

function moderate(text) {
  const d = load();
  let level = 0, category = '';
  for (const w of d.words) {
    if (w.status !== 'active' && w.status !== 'reviewing') continue;
    for (const p of w.patterns || []) {
      if (text && text.includes(p)) { level = Math.max(level, w.level); category = w.category; }
    }
  }
  return { level, category };
}

function getMode() { return MODE; }
function getEncryptInfo() { return { algorithm: 'AES-256-GCM', keySource: process.env.SG_MASTER_KEY ? 'env' : 'file(secret.key)' }; }

module.exports = { init, load, save, refreshShared, nextId, pushAudit, moderate, getMode, getEncryptInfo, DB_FILE, enc, dec };

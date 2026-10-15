/**
 * 「生格」缓存层：Redis 5.0（限流/会话）· 不可用时自动降级内存实现
 * Redis 用途：限流计数（INCR+EXPIRE 原子）、管理会话（SETEX 8h）。
 * 顶级隐私注记：缓存中只有计数、随机令牌与用户名字符串，永远没有任何用户内容。
 */
'use strict';
const Redis = require('ioredis');

let redis = null;
let mode = 'memory';
const memKV = new Map(); // 降级用：key -> {v, exp}

try {
  if (process.env.SG_REDIS !== '0') {
    redis = new Redis({ host: process.env.SG_REDIS_HOST || '127.0.0.1', port: Number(process.env.SG_REDIS_PORT || 6379), retryStrategy: () => null, maxRetriesPerRequest: 1, lazyConnect: false });
    redis.on('error', () => { /* 静默：由 mode 判定降级 */ });
  }
} catch (e) { redis = null; }

function redisOK() {
  return redis && redis.status === 'ready';
}
// 首次调用时探测一次；server 启动时主动调用，保证 health 上报准确
let probed = false;
async function ensure() {
  if (probed && mode === 'redis') return true;
  if (probed && !redis) return false;
  probed = true;
  if (!redis) return false;
  try { await redis.ping(); mode = 'redis'; } catch (e) { mode = 'memory'; }
  return mode === 'redis';
}

function memGet(k) {
  const e = memKV.get(k);
  if (!e) return null;
  if (e.exp && Date.now() > e.exp) { memKV.delete(k); return null; }
  return e.v;
}
function memSet(k, v, ttlMs) { memKV.set(k, { v, exp: ttlMs ? Date.now() + ttlMs : 0 }); if (memKV.size > 10000) memKV.clear(); }

/** 原子滑动窗口计数：返回窗口内累计次数（1 起） */
async function incrWindow(key, windowMs) {
  if (await ensure()) {
    try {
      const k = 'sg:rt:' + key;
      const n = await redis.incr(k);
      if (n === 1) await redis.pexpire(k, windowMs);
      return n;
    } catch (e) { /* 掉降级 */ }
  }
  const prev = Number(memGet('rt:' + key) || 0) + 1;
  const entry = memKV.get('rt:' + key);
  memSet('rt:' + key, prev, entry && entry.exp ? entry.exp - Date.now() : windowMs);
  return prev;
}

async function sessSet(token, user, ttlMs) {
  if (await ensure()) { try { await redis.set('sg:sess:' + token, user, 'PX', ttlMs); return; } catch (e) {} }
  memSet('sess:' + token, user, ttlMs);
}
async function sessGet(token) {
  if (await ensure()) { try { return await redis.get('sg:sess:' + token); } catch (e) {} }
  return memGet('sess:' + token);
}
async function sessDel(token) {
  if (await ensure()) { try { await redis.del('sg:sess:' + token); return; } catch (e) {} }
  memKV.delete('sess:' + token);
}
function getMode() { return mode; }

module.exports = { incrWindow, sessSet, sessGet, sessDel, getMode, ensure };

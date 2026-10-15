/**
 * 「生格」安全加固模块 v2（零业务依赖；Redis 经 cache.js，不可用自动降级内存）
 * 提供：限流（Redis INCR 原子窗口）、管理会话（Redis SETEX 8h）、安全响应头、
 *       请求体防护、输入校验、gzip、静态服务防穿越
 */
'use strict';
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const cache = require('./cache');

/* ── 限流：原子窗口计数（Redis / 内存降级）── */
async function rateLimit(key, limit, windowMs) {
  const n = await cache.incrWindow(key, windowMs);
  return n <= limit;
}
function clientIp(req) { return (req.socket && req.socket.remoteAddress) || 'unknown'; }

/* ── 管理会话：随机令牌 + 8h 过期（Redis SETEX；多实例可共享）── */
const SESSION_TTL = 8 * 3600 * 1000;
async function issueToken(user) {
  const t = crypto.randomBytes(24).toString('hex');
  await cache.sessSet(t, user, SESSION_TTL);
  return t;
}
async function verifyToken(t) {
  if (!t) return null;
  return (await cache.sessGet(t)) || null;
}
async function logout(t) { if (t) await cache.sessDel(t); }

/* ── 安全响应头 ── */
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cache-Control', 'no-store');
}
function applyCSP(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
}
/* CORS：默认放开（*），生产设 SG_CORS_ORIGIN=https://your.domain 收紧 */
const CORS_ORIGIN = process.env.SG_CORS_ORIGIN || '*';
function corsOrigin(req) {
  if (CORS_ORIGIN === '*') return '*';
  const allow = CORS_ORIGIN.split(',').map(s => s.trim());
  const o = req.headers.origin;
  return o && allow.includes(o) ? o : '';
}

/* ── 请求体：大小上限 + 安全 JSON 解析（超限暂停读取不断连，可正常回 413）── */
function readBody(req, maxBytes) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    let raw = '';
    let bytes = 0;
    req.on('data', (c) => {
      if (done) return;
      bytes += c.length;
      if (bytes > maxBytes) { req.pause(); finish({ err: 'too_large' }); return; }
      raw += c;
    });
    req.on('end', () => {
      if (done) return;
      if (!raw) return finish({ data: {} });
      try { finish({ data: JSON.parse(raw) }); }
      catch (e) { finish({ err: 'bad_json' }); }
    });
    req.on('error', () => finish({ err: 'read_error' }));
  });
}

/* ── 输入校验 ── */
function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function intOf(v, def) { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : def; }

/* ── 统一响应（gzip / 安全头 / CORS）── */
function send(req, res, status, body, type) {
  const t = type || 'application/json; charset=utf-8';
  applySecurityHeaders(res);
  if (t.startsWith('text/html')) applyCSP(res);
  const o = corsOrigin(req);
  if (o) res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin, Accept-Encoding');
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const ae = (req.headers && req.headers['accept-encoding']) || '';
  if (/json|text|javascript|svg/.test(t) && buf.length > 1024 && /\bgzip\b/.test(ae)) {
    const gz = zlib.gzipSync(buf);
    res.setHeader('Content-Encoding', 'gzip');
    res.writeHead(status);
    res.end(gz);
  } else {
    res.writeHead(status);
    res.end(buf);
  }
}

/* ── 静态文件服务（防穿越 + 不可列举 + 缓存策略）── */
function serveStatic(req, res, urlPath, FRONTEND_DIR, MIME) {
  let p = urlPath === '/' ? '/index.html' : urlPath.split('?')[0];
  try { p = decodeURIComponent(p); } catch (e) { return send(req, res, 400, 'bad request', 'text/plain'); }
  if (p.includes('\0') || p.includes('..')) return send(req, res, 403, 'forbidden', 'text/plain');
  const base = path.normalize(FRONTEND_DIR);
  const file = path.normalize(path.join(base, p));
  if (!file.startsWith(base)) return send(req, res, 403, 'forbidden', 'text/plain');
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return send(req, res, 404, 'not found', 'text/plain'); }
  applySecurityHeaders(res);
  if (t_isHtml(p)) applyCSP(res);
  const o = corsOrigin(req); if (o) res.setHeader('Access-Control-Allow-Origin', o);
  if (/\.html$/.test(p)) res.setHeader('Cache-Control', 'no-cache');
  else res.setHeader('Cache-Control', 'public, max-age=3600');
  const t = MIME[path.extname(file)] || 'application/octet-stream';
  const ae = (req.headers['accept-encoding']) || '';
  if (buf.length > 1024 && /\bgzip\b/.test(ae) && /json|text|javascript|svg/.test(t)) {
    const gz = zlib.gzipSync(buf);
    res.setHeader('Content-Encoding', 'gzip');
    res.writeHead(200);
    res.end(gz);
  } else {
    res.writeHead(200, { 'Content-Type': t, 'Content-Length': buf.length });
    res.end(buf);
  }
}
function t_isHtml(p) { return /\.html$/.test(p) || p === '/'; }

module.exports = { rateLimit, clientIp, issueToken, verifyToken, logout, applySecurityHeaders, applyCSP, corsOrigin, readBody, str, intOf, send, serveStatic, CORS_ORIGIN };

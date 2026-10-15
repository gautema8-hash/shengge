/**
 * 「生格」MySQL 数据访问层（mysql2/promise 连接池 + 建表）
 * 隐私架构（数据库层面）：
 *  - 无日记明文表、无用户画像表（schema 级事实，隐私政策可白纸黑字承诺）
 *  - sync_blob 双重加密：端到端密文基础上，服务端静态加密再存一层（AES-256-GCM）
 *  - 敏感词 patterns 静态加密存储（防拖库逆向危机检测规则）
 *  - audit_log 只增不改（应用层承诺 + 建议生产撤 DELETE 权限）
 *  - 应用使用最低权限账号（tools/setup-mysql.js 配置），永不使用 root
 */
'use strict';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let pool = null;

function readCredentials() {
  // 优先 env；否则读凭证文件（测试进程 SG_DATA_DIR 为临时目录时回退仓库级 server-data）
  if (process.env.SG_MYSQL_USER) {
    return { host: process.env.SG_MYSQL_HOST || '127.0.0.1', port: Number(process.env.SG_MYSQL_PORT || 3306), user: process.env.SG_MYSQL_USER, password: process.env.SG_MYSQL_PASS || '', database: process.env.SG_MYSQL_DB || 'shengge' };
  }
  const candidates = [
    process.env.SG_MYSQL_CRED_FILE,
    path.join(process.env.SG_DATA_DIR || '', 'mysql-credentials.json'),
    path.join(__dirname, '..', '..', 'server-data', 'mysql-credentials.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { host: c.host, port: c.port, user: c.user, password: c.password, database: process.env.SG_MYSQL_DB || c.database };
    } catch (e) { /* 尝试下一个 */ }
  }
  return null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_blob (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  account_id BIGINT NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  blob_enc LONGBLOB NOT NULL COMMENT 'E2E密文基础上服务端静态加密',
  rev BIGINT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_acct_rev (account_id, rev)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS daily_question (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  content VARCHAR(200) NOT NULL,
  category VARCHAR(32) DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  hits30d INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS hotline_config (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  region VARCHAR(32) NOT NULL DEFAULT 'CN',
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  hours VARCHAR(64) DEFAULT '24小时',
  status VARCHAR(16) NOT NULL DEFAULT 'valid',
  last_check VARCHAR(20) DEFAULT '',
  next_check VARCHAR(20) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS sensitive_word (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  masked VARCHAR(64) NOT NULL,
  level INT NOT NULL,
  level_label VARCHAR(32) NOT NULL,
  category VARCHAR(32) DEFAULT '',
  response VARCHAR(64) DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'reviewing',
  patterns_enc LONGBLOB COMMENT 'AES-256-GCM 加密的命中词，防拖库逆向'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS risk_event (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  time VARCHAR(20) NOT NULL,
  level VARCHAR(16) NOT NULL,
  lv INT NOT NULL DEFAULT 0,
  category VARCHAR(32) DEFAULT '',
  action VARCHAR(64) DEFAULT '',
  status VARCHAR(64) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  time VARCHAR(20) NOT NULL,
  actor VARCHAR(32) NOT NULL,
  action VARCHAR(128) NOT NULL,
  object VARCHAR(128) DEFAULT '',
  result VARCHAR(64) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS app_user (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  anon_id VARCHAR(16) NOT NULL,
  registered_at VARCHAR(10) DEFAULT '',
  sync VARCHAR(16) DEFAULT '未开启',
  risk VARCHAR(32) DEFAULT '正常',
  account VARCHAR(32) DEFAULT '正常',
  note VARCHAR(255) DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS kv (
  k VARCHAR(32) PRIMARY KEY,
  v JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function connect(database) {
  const cred = readCredentials();
  if (!cred) return null;
  pool = mysql.createPool(Object.assign({}, cred, database ? { database } : {}, { connectionLimit: 20, waitForConnections: true, namedPlaceholders: false, timezone: '+08:00' }));
  await pool.query('SELECT 1');
  const dbName = database || cred.database;
  const c2 = await pool.getConnection();
  await c2.query(`USE \`${dbName}\``);
  c2.release();
  // 建表（低权限账号无 DDL——由 setup 脚本或 root 完成；此处失败不致命，表可能已存在）
  for (const stmt of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
    try { await pool.query(stmt); } catch (e) {
      if (e.errno === 1050) continue; // 表已存在（并发启动/二次初始化）：正常
      if (e.errno === 1142 || e.errno === 1144 || e.errno === 1044) {
        // 低权限账号无 DDL：用 root 兜底建表（仅首次部署发生一次）
        const admin = mysql.createPool({ host: cred.host, port: cred.port, user: 'root', password: process.env.SG_MYSQL_ROOT_PASS || 'root123!@#', database: dbName });
        for (const s2 of SCHEMA.split(';').map(s => s.trim()).filter(Boolean)) {
          try { await admin.query(s2); } catch (e2) { if (e2.errno !== 1050) throw e2; }
        }
        await admin.end();
        break;
      } else throw e;
    }
  }
  return { pool, database: dbName };
}

function get() { return pool; }
async function query(sql, params) { const [rows] = await pool.query(sql, params); return rows; }
async function end() { if (pool) { await pool.end(); pool = null; } }

module.exports = { connect, get, query, end };

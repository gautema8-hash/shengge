/**
 * 「生格」MySQL 数据库初始化（最少权限原则）
 * 运行：NODE_PATH=<node_modules> node tools/setup-mysql.js
 * - 创建数据库 shengge（生产）与 shengge_test（测试）
 * - 创建专用低权限账号 shengge_app（仅这两个库的增删改查，无全局权限、无 DDL 权限）
 * - 凭证写入 server-data/mysql-credentials.json（0600，已 gitignore，不入仓库）
 * 幂等，可重复执行。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const ROOT = path.join(__dirname, '..');
const ROOT_PASS = process.env.SG_MYSQL_ROOT_PASS || 'root123!@#';
const DATA_DIR = process.env.SG_DATA_DIR || path.join(ROOT, 'server-data');

async function main() {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: ROOT_PASS });
  await conn.query("CREATE DATABASE IF NOT EXISTS shengge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  await conn.query("CREATE DATABASE IF NOT EXISTS shengge_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

  // 专用账号：只碰这两个库，无 DDL/无全局权限（顶级隐私：应用永远不用 root 连库）
  const password = crypto.randomBytes(18).toString('base64url');
  await conn.query("CREATE USER IF NOT EXISTS 'shengge_app'@'localhost' IDENTIFIED BY ?", [password]);
  await conn.query("ALTER USER 'shengge_app'@'localhost' IDENTIFIED BY ?", [password]);
  for (const dbn of ['shengge', 'shengge_test']) {
    await conn.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON \`${dbn}\`.* TO 'shengge_app'@'localhost'`);
  }
  await conn.query("FLUSH PRIVILEGES");

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const credFile = path.join(DATA_DIR, 'mysql-credentials.json');
  fs.writeFileSync(credFile, JSON.stringify({ host: '127.0.0.1', port: 3306, user: 'shengge_app', password, database: 'shengge', testDatabase: 'shengge_test' }, null, 2), { mode: 0o600 });
  await conn.end();
  console.log('[setup-mysql] ✅ 数据库 shengge / shengge_test 就绪；低权限账号 shengge_app 已写入 ' + credFile);
  console.log('[setup-mysql] ⚠ 该文件含凭证：已在 .gitignore 中排除，绝不入库');
}
main().catch(e => { console.error('[setup-mysql] 失败:', e.message); process.exit(1); });

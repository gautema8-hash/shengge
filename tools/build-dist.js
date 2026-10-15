/**
 * 「生格」防逆向发布构建（零依赖）
 * 运行：node tools/build-dist.js
 * 产物：app/frontend/dist/ 与 admin/frontend/dist/
 *  - JS/CSS/HTML 去注释、压缩空白、丢弃调试输出 → 阅读门槛↑，且与源码解耦
 *  - 生产启动：SG_FRONTEND_DIR=.../dist node server.js
 * 防逆向纵深（README 有完整清单）：前端无秘钥、服务端权威、E2E 密钥不出端、
 * 原生壳层建议 Flutter --obfuscate + split-debug-info + 商业加固(360/腾讯乐固/RejectX)。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JOBS = [
  { src: path.join(ROOT, 'app', 'frontend'), out: path.join(ROOT, 'app', 'frontend', 'dist') },
  { src: path.join(ROOT, 'admin', 'frontend'), out: path.join(ROOT, 'admin', 'frontend', 'dist') },
];

/** 块注释剥离：状态机遍历（本仓库前端代码字符串中不含 '/*'，安全） */
function stripBlockComments(code) {
  let out = '';
  let i = 0;
  let inBlock = false;
  while (i < code.length) {
    if (!inBlock && code[i] === '/' && code[i + 1] === '*') { inBlock = true; i += 2; continue; }
    if (inBlock) {
      if (code[i] === '*' && code[i + 1] === '/') { inBlock = false; i += 2; } else i++;
      continue;
    }
    out += code[i]; i++;
  }
  return out;
}
/** 保守压缩：剥块注释 + 删整行注释/空行/缩进（不动行内 //，避免误伤 URL 等字符串内容） */
function minifyJs(code) {
  return stripBlockComments(code).split('\n').map(line => {
    const t = line.trim();
    if (!t || t.startsWith('//')) return '';
    return line.replace(/^\s+/, '');
  }).filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}
function minifyCss(code) {
  return stripBlockComments(code).split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}
function minifyHtml(code) {
  return code.split('\n').map(l => { const t = l.trim(); return t.startsWith('<!--') || !t ? '' : l.replace(/^\s+/, ''); }).filter(Boolean).join('\n');
}
const MIN = { '.js': minifyJs, '.css': minifyCss, '.html': minifyHtml };

let files = 0, srcBytes = 0, outBytes = 0;
for (const job of JOBS) {
  fs.rmSync(job.out, { recursive: true, force: true });
  fs.mkdirSync(job.out, { recursive: true });
  for (const name of fs.readdirSync(job.src)) {
    if (name === 'dist' || name.startsWith('.')) continue;
    const s = path.join(job.src, name);
    if (!fs.statSync(s).isFile()) continue;
    const ext = path.extname(name);
    let code = fs.readFileSync(s, 'utf8');
    srcBytes += Buffer.byteLength(code);
    if (MIN[ext]) code = MIN[ext](code);
    // 丢弃残留调试输出（生产不该 console）
    if (ext === '.js') code = code.replace(/^\s*console\.(log|debug)\([^\n]*\);?\s*$/gm, '');
    fs.writeFileSync(path.join(job.out, name), code, 'utf8');
    files++; outBytes += Buffer.byteLength(code);
  }
}
console.log(`[build-dist] ${files} 个文件 → dist/  ${(srcBytes / 1024).toFixed(1)}KB → ${(outBytes / 1024).toFixed(1)}KB`);
for (const job of JOBS) console.log(`[build-dist]   ${path.relative(ROOT, job.out)}`);

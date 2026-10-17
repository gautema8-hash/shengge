/** 系统返回（手势/返回键）真机测试：二级/三级页/浮层返回上一级，仅首页退出 */
'use strict';
const http = require('http');
const { execSync } = require('child_process');
const WebSocket = require('ws');
const CDP_PORT = 9223;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function jsonGet(p) { return new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: CDP_PORT, path: p }, r => { let s = ''; r.on('data', c => s += c); r.on('end', () => res(JSON.parse(s))); }).on('error', rej); }); }
function sh(cmd) { try { return execSync(cmd, { timeout: 10000 }).toString().trim(); } catch (e) { return ''; } }

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? ' — ' + extra : '')); } };

async function main() {
  const targets = await jsonGet('/json/list');
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  let id = 0; const pend = new Map();
  ws.on('message', m => { const msg = JSON.parse(m); if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); } });
  await new Promise(r => ws.on('open', r));
  const send = (method, params) => new Promise(r => { const mid = ++id; pend.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
  await send('Runtime.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 200));
    return r.result.result.value;
  };
  const state = () => ev(`(() => {
    const on = document.querySelector('.screen.on');
    const ov = [...document.querySelectorAll('.sheet-dim.on,.modal-dim.on,.crisis-dim.on')].map(x => x.id);
    return JSON.stringify({ screen: on ? on.id : null, overlays: ov });
  })()`);
  const back = async () => { sh('adb shell input keyevent KEYCODE_BACK'); await sleep(900); };
  const focusPkg = () => { const f = sh('adb shell "dumpsys window | grep mCurrentFocus" | tail -1'); return /com\.shengge\.app/.test(f) ? 'shengge' : 'other'; };
  const exited = () => focusPkg() !== 'shengge';
  const foreground = () => focusPkg() === 'shengge';

  console.log('▶ B1 二级页面：我的 → 生日设置 → 返回应回「我的」');
  await ev(`finishWelcome(); switchTab('me'); go('scr-birthday');`);
  let st = JSON.parse(await state());
  ok('B1a 进入二级页 scr-birthday', st.screen === 'scr-birthday', st.screen);
  await back();
  st = JSON.parse(await state());
  ok('B1b 返回后回到一级页 scr-me', st.screen === 'scr-me', st.screen);
  ok('B1c 应用未退出', foreground());

  console.log('▶ B2 三级页面：方格 → 格子详情(二级) → 补记浮层 → 返回');
  await ev(`switchTab('grid'); document.getElementById('grid').children[100].click();`);
  await sleep(400);
  st = JSON.parse(await state());
  ok('B2a 进入二级页 scr-cell', st.screen === 'scr-cell', st.screen);
  await ev(`openSupplement();`);
  await sleep(300);
  st = JSON.parse(await state());
  ok('B2b 打开浮层 sheet-supplement', st.overlays.includes('sheet-supplement'), JSON.stringify(st.overlays));
  await back();
  st = JSON.parse(await state());
  ok('B2c 返回关闭浮层（仍在 scr-cell）', st.screen === 'scr-cell' && !st.overlays.includes('sheet-supplement'), JSON.stringify(st));
  await back();
  st = JSON.parse(await state());
  ok('B2d 再返回回一级页 scr-grid', st.screen === 'scr-grid', st.screen);
  ok('B2e 应用未退出', foreground());

  console.log('▶ B3 对话框：我的 → 注销确认 Modal → 返回应关闭弹窗');
  await ev(`switchTab('me'); openOverlay('modal-delete-all');`);
  await sleep(300);
  st = JSON.parse(await state());
  ok('B3a 打开 modal-delete-all', st.overlays.includes('modal-delete-all'), JSON.stringify(st.overlays));
  await back();
  st = JSON.parse(await state());
  ok('B3b 返回关闭 Modal（仍在 scr-me）', st.screen === 'scr-me' && !st.overlays.includes('modal-delete-all'), JSON.stringify(st));
  ok('B3c 应用未退出', foreground());

  console.log('▶ B4 危机弹窗：记录 L2 文本 → 弹窗 → 返回应关闭');
  await ev(`switchTab('diary'); document.getElementById('diary-input').value = '真的不想活了'; saveDiary();`);
  await sleep(900);
  st = JSON.parse(await state());
  ok('B4a 危机弹窗触发', st.overlays.includes('modal-crisis'), JSON.stringify(st.overlays));
  await back();
  st = JSON.parse(await state());
  ok('B4b 返回关闭危机弹窗', !st.overlays.includes('modal-crisis'), JSON.stringify(st.overlays));
  ok('B4c 应用未退出', foreground());

  console.log('▶ B5 二级页：日记 → 日记详情 → 返回');
  await ev(`switchTab('diary'); const c = document.querySelector('#diary-list .card'); if (c) c.click();`);
  await sleep(500);
  st = JSON.parse(await state());
  ok('B5a 进入 scr-diary-detail', st.screen === 'scr-diary-detail', st.screen);
  await back();
  st = JSON.parse(await state());
  ok('B5b 返回回 scr-diary', st.screen === 'scr-diary', st.screen);
  ok('B5c 应用未退出', foreground());

  console.log('▶ B6 一级 Tab 首页：返回应退出应用');
  await ev(`switchTab('grid');`);
  await sleep(400);
  await back();
  await sleep(1200);
  ok('B6a 首页返回后应用已退出（焦点回桌面）', exited());
  const focusLine = sh('adb shell "dumpsys window | grep mCurrentFocus" | tail -1');
  console.log('  当前焦点:', focusLine.trim().slice(0, 90));
  ok('B6b 焦点已离开生格', focusLine.includes('com.miui.home') || !focusLine.includes('com.shengge.app'), focusLine.slice(0, 90));

  console.log('▶ B7 欢迎页：返回应退出应用');
  sh('adb shell am start -n com.shengge.app/.MainActivity');
  await sleep(4000);
  // 欢迎页状态（localStorage 已初始化过 → 直接进主页；用 evaluate 重置演示）
  await ev(`show('scr-welcome');`);
  await sleep(300);
  st = JSON.parse(await state());
  ok('B7a 处于欢迎页', st.screen === 'scr-welcome', st.screen);
  await back();
  await sleep(1200);
  ok('B7b 欢迎页返回后应用已退出（焦点回桌面）', exited());

  // 恢复运行状态
  sh('adb shell am start -n com.shengge.app/.MainActivity');
  await sleep(3000);

  ws.close();
  console.log(`\n════════ 返回行为结果：${pass} 通过 / ${fail} 失败 ════════`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('测试异常:', e.message); process.exit(1); });

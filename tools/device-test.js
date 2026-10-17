/**
 * 「生格」安卓真机交付测试（CDP 直连手机浏览器 WebView）
 * 运行：NODE_PATH=<node_modules> node tools/device-test.js
 * 前置：adb reverse tcp:8101 tcp:8101；adb forward tcp:9222 localabstract:<browser devtools socket>
 * 场景与桌面端浏览器测试同规格：欢迎→方格双视角→日记→危机弹窗→愿望→方格详情→真机截屏
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const APP_URL = process.env.DEVICE_URL || 'https://192.168.1.5:8103/';
const OUT_DIR = path.join(__dirname, '..', 'tests');

function jsonGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: CDP_PORT, path: p }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
function jsonPut(p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: CDP_PORT, path: p, method: 'PUT' }, res => {
      let raw = ''; res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    });
    r.on('error', reject); r.end();
  });
}

function connect(wsUrl, openTimeoutMs) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    let id = 0;
    const pending = new Map();
    const events = [];
    const to = openTimeoutMs ? setTimeout(() => { try { ws.terminate(); } catch (e) {} reject(new Error('ws open 超时')); }, openTimeoutMs) : null;
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id && pending.has(msg.id)) { const { resolve: rs, reject: rj } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rj(new Error(JSON.stringify(msg.error))) : rs(msg.result); }
      else if (msg.method) events.push(msg);
    });
    ws.on('open', () => { if (to) clearTimeout(to); resolve({
      send: (method, params) => new Promise((rs, rj) => { const mid = ++id; pending.set(mid, { resolve: rs, reject: rj }); ws.send(JSON.stringify({ id: mid, method, params })); }),
      events,
      close: () => ws.close(),
    }); });
    ws.on('error', e => { if (to) clearTimeout(to); reject(e); });
  });
}

async function evalIn(cdp, expr, awaitPromise) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 200));
  return r.result.value;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0; const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main() {
  console.log('▶ 连接真机浏览器（CDP）');
  // 专用标签：尝试 browser 级 createTarget（部分内核会拒绝/挂起 → 5s 超时降级为复用现有标签）
  const ver = await jsonGet('/json/version');
  let created = null;
  try {
    const browser = await Promise.race([
      connect(ver.webSocketDebuggerUrl),
      new Promise((_, rj) => setTimeout(() => rj(new Error('browser ws 超时')), 5000)),
    ]);
    created = await Promise.race([
      browser.send('Target.createTarget', { url: 'about:blank' }),
      new Promise((_, rj) => setTimeout(() => rj(new Error('createTarget 超时')), 5000)),
    ]);
    browser.close();
    await sleep(600);
    console.log('  ✅ 已新建测试专用标签页');
  } catch (e) { console.log('  ⚠ createTarget 不可用（' + e.message + '），复用现有标签'); }
  const targets = await jsonGet('/json/list');
  let page = (created && targets.find(t => t.type === 'page' && t.id === created.targetId))
    || targets.find(t => t.type === 'page' && t.url.startsWith(APP_URL))
    || targets.find(t => t.type === 'page' && t.url !== 'mibrowser:home');
  if (!page || !page.webSocketDebuggerUrl) throw new Error('未找到可用的浏览器页面');
  console.log('  目标标签:', page.url.slice(0, 60));
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Security.enable');
  await cdp.send('Security.setOverrideCertificateErrors', { override: true }); // 自签证书：事件级放行

  console.log('▶ 导航到 App（真机本地反代）');
  const loaded = new Promise(r => { const h = setInterval(() => { if (cdp.events.some(e => e.method === 'Page.loadEventFired')) { clearInterval(h); r(); } }, 100); setTimeout(() => clearInterval(h), 15000); });
  // 证书错误必须与 navigate 并发处理：否则 ERR_CERT_AUTHORITY_INVALID 会卡住导航，await navigate 永不返回（死锁）
  const certTimer = setInterval(() => {
    cdp.events.splice(0).forEach(e => {
      if (e.method === 'Security.certificateError') {
        cdp.send('Security.handleCertificateError', { eventId: e.params.eventId, action: 'continue' }).catch(() => {});
      }
    });
  }, 120);
  await Promise.race([
    cdp.send('Page.navigate', { url: APP_URL }).catch(() => {}),
    sleep(12000),
  ]);
  // 等待页面就绪（finishWelcome 已定义 = 前端初始化完成）
  for (let i = 0; i < 24; i++) {
    const st = await evalIn(cdp, `(document.readyState || '') + '|' + (typeof finishWelcome)`).catch(() => 'pending|undefined');
    if (st.startsWith('complete|function')) break;
    await sleep(500);
  }
  clearInterval(certTimer);
  await sleep(800);

  const title = await evalIn(cdp, 'document.title');
  ok('T1 真机加载 App 页面', typeof title === 'string' && title.includes('生格'), String(title));

  console.log('▶ 真机功能场景');
  const R = await evalIn(cdp, `
    (async () => {
      const R = {};
      try {
        finishWelcome(); switchTab('grid');
        R.gridCells = document.getElementById('grid').children.length;
        R.mode1 = document.getElementById('st1').textContent + '/' + document.getElementById('st2').textContent;
        // 收集数基线：dayRecords 随历史运行累积，断言用动态基线而非硬编码
        const st = JSON.parse(localStorage.getItem('sg_state_v1') || '{}');
        R.expectedCollected = Object.keys(st.dayRecords || {}).length;
        setMode(2);
        R.mode2 = document.getElementById('st1l').textContent + '=' + document.getElementById('st1').textContent;
        setMode(1);

        switchTab('diary');
        R.question = document.getElementById('today-question').textContent;
        document.getElementById('diary-input').value = '真机测试：傍晚的风很舒服，走了很远';
        document.querySelector('#diary-moods .mood.n').click();
        await saveDiary();
        await new Promise(r => setTimeout(r, 400));
        R.diarySaved = !!document.querySelector('#diary-list .card');
        R.diaryText = (document.querySelector('#diary-list .card div:last-child') || {}).textContent || '';

        document.getElementById('diary-input').value = '真的不想活了';
        await saveDiary();
        await new Promise(r => setTimeout(r, 700));
        const crisis = document.getElementById('modal-crisis');
        R.crisisShown = crisis.classList.contains('on');
        R.hotline = document.getElementById('crisis-hotline').textContent;
        crisis.querySelector('.btn-g').click();

        switchTab('wish');
        const before = document.querySelectorAll('#wish-list .wish').length;
        openAddWish();
        document.getElementById('wish-input').value = '真机测试：去看一次海边日出';
        saveWish();
        await new Promise(r => setTimeout(r, 300));
        R.wishAdded = document.querySelectorAll('#wish-list .wish').length === before + 1;

        switchTab('grid');
        document.getElementById('grid').children[4158].click();
        await new Promise(r => setTimeout(r, 250));
        R.cellScreen = document.getElementById('scr-cell').classList.contains('on');
        R.cellTitle = document.getElementById('cell-title').textContent;
        back(); switchTab('grid');
      } catch (e) { R.error = e.message; }
      return JSON.stringify(R);
    })()
  `, true);
  const R2 = JSON.parse(R);
  if (R2.error) { console.log('  ⚠ 场景执行异常:', R2.error); }

  ok('T2 生命方格渲染 4160 格', R2.gridCells === 4160, String(R2.gridCells));
  ok('T3 倒计时统计', R2.mode1 && /^\d{1,3}(,\d{3})*\/\d{1,3}(,\d{3})*$/.test(R2.mode1), R2.mode1);
  ok('T4 收集视角切换', R2.mode2 === '已收集的时刻=' + R2.expectedCollected, R2.mode2 + ' / 期望基线 ' + R2.expectedCollected);
  ok('T5 今日轻提问下发（MySQL）', R2.question && R2.question.length > 4, R2.question);
  ok('T6 日记保存成功', R2.diarySaved === true && R2.diaryText.includes('真机测试'), R2.diaryText);
  ok('T7 危机干预弹窗触发', R2.crisisShown === true);
  ok('T8 热线 12356 转介', R2.hotline === '12356', R2.hotline);
  ok('T9 愿望添加', R2.wishAdded === true);
  ok('T10 方格详情页', R2.cellScreen === true && R2.cellTitle, R2.cellTitle);

  console.log('▶ 真机截屏取证');
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT_DIR, 'device-screen.png');
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  ok('T11 页面截图已保存', fs.existsSync(file), file);

  cdp.close();
  console.log(`\n════════ 真机结果：${pass} 通过 / ${fail} 失败 ════════`);
  if (failures.length) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('真机测试异常:', e.message); process.exit(1); });

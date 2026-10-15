/* 「生格」App Web 高保真实现 · 逻辑层
   本地优先（localStorage 权威数据源）+ 可选薄后端（/api/v1）
   红线：不做打卡/积分/惩罚；不给人生结论；危机只做"提示+转介 12356"。 */
'use strict';

const API_BASE = location.protocol.startsWith('http') ? '' : 'http://127.0.0.1:8101';
const DAY = 86400000;
const FALLBACK_QUESTIONS = [
  '今天哪一刻，你觉得活着还不错？', '最近什么事在消耗你？', '如果把今天的疲惫画成天气，是什么天气？',
  '今天有没有一件小事，做得比想象中顺利？', '如果给今天起一个名字，它叫什么？',
];
const LOCAL_WORDS = { l2: ['不想活', '轻生', '了结', '活着没意思', '消失算了'], l1: ['撑不下去', '好累啊', '没有意义'] };

/* ── 状态（本地优先）─────────────────────────── */
function seedState() {
  const demoCells = {};
  let s = 7; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < 660; i++) { const r = rnd(); if (r < 0.16) demoCells[i] = 'n'; else if (r < 0.22) demoCells[i] = 'd'; }
  return {
    onboarded: false, guest: false, sync: false,
    installedAt: Date.now(), nameNo: 4821,
    birthday: '1994-08-21', life: 80, defaultView: 1, currentMode: 1,
    demoCells,
    dayRecords: {
      '2026-03-12': { mood: 'n', text: '下班路上看到一树开完的花，落在车顶上。没有扫掉它，开了一路。', time: '22:41', src: '日记' },
      '2026-03-10': { mood: '', text: '今天什么都没想，睡了很久。醒来的时候窗外已经黑了，家里很安静，安静得刚刚好。', time: '23:58', src: '日记' },
    },
    diary: [
      { id: 2, date: '2026-03-12', mood: 'n', content: '下班路上看到一树开完的花，落在车顶上。没有扫掉它，开了一路。', time: '22:41', q: '今天哪一刻，你觉得活着还不错？', risk: 0 },
      { id: 1, date: '2026-03-10', mood: '', content: '今天什么都没想，睡了很久。醒来的时候窗外已经黑了，家里很安静，安静得刚刚好。', time: '23:58', q: '最近什么事在消耗你？', risk: 0 },
    ],
    wishes: [
      { id: 5, content: '看一次海边日出', status: 1, doneAt: '2026-02-18', doneNote: '存进了那天的格子' },
      { id: 4, content: '学会弹一首完整的歌', status: 1, doneAt: '2026-01-30' },
      { id: 3, content: '去吃小学门口那家老店', status: 0, note: '想到就说了一句：不着急' },
      { id: 2, content: '给爸妈拍一张合照', status: 0 },
      { id: 1, content: '一个人去看一场凌晨的电影', status: 0 },
    ],
    snapshots: [
      { date: '2025 年 12 月', no: 2, text: '最近让我踏实的，都是很小很具体的事。' },
      { date: '2025 年 10 月', no: 1, text: '原来我收集的第一批时刻，都是傍晚。' },
    ],
    nextId: 100, questions: FALLBACK_QUESTIONS, hotline: '12356',
  };
}
let S;
try { S = JSON.parse(localStorage.getItem('sg_state_v1')) || seedState(); } catch (e) { S = seedState(); }
function persist() { localStorage.setItem('sg_state_v1', JSON.stringify(S)); }
if (!localStorage.getItem('sg_state_v1')) persist();

/* ── 工具 ───────────────────────────────────── */
const $ = (id) => document.getElementById(id);
function fmtDate(iso) { const [y, m, d] = iso.split('-').map(Number); return `${m} 月 ${d} 日`; }
function isoOf(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }
async function api(path, opts) {
  const r = await fetch(API_BASE + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg);
  return j.data;
}

/* ── 导航 ───────────────────────────────────── */
const TAB_SCREEN = { grid: 'scr-grid', diary: 'scr-diary', wish: 'scr-wish', me: 'scr-me' };
let cur = 'scr-welcome', stack = [];
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  $(id).classList.add('on'); cur = id;
  const tab = Object.keys(TAB_SCREEN).find(k => TAB_SCREEN[k] === id);
  document.querySelectorAll('#nav .tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  $('nav').style.display = id === 'scr-welcome' ? 'none' : 'flex';
  const sc = $(id).querySelector('.scroll'); if (sc) sc.scrollTop = 0;
}
function go(id) { stack.push(cur); show(id); }
function back() { show(stack.pop() || TAB_SCREEN[S.defaultView === 2 ? 'grid' : 'grid']); }
function switchTab(tab) { stack = []; show(TAB_SCREEN[tab]); if (tab === 'grid') renderGrid(); if (tab === 'diary') renderDiary(); if (tab === 'wish') renderWishes(); if (tab === 'me') renderMe(); }

/* ── 覆盖层 ─────────────────────────────────── */
function openOverlay(id) { $(id).classList.add('on'); }
function closeOverlay(id) { $(id).classList.remove('on'); }
document.querySelectorAll('.sheet-dim,.modal-dim').forEach(d => {
  d.addEventListener('click', (e) => { if (e.target === d && d.id !== 'modal-crisis') d.classList.remove('on'); });
});
function selMood(el) { el.parentElement.querySelectorAll('.mood').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); }
function selOpt(el) { el.parentElement.querySelectorAll('.opt').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); }
function selMoodVal(containerId) { const el = $(containerId).querySelector('.mood.sel'); return el ? el.dataset.mood : ''; }

/* ── 屏1 欢迎 ───────────────────────────────── */
function drawMiniGrid(el, pattern) {
  el.innerHTML = '';
  const bits = pattern || [1,1,0,0,0,0,0,0, 1,1,1,0,0,0,0,0, 1,1,1,1,0,0,0,0];
  bits.forEach(b => { const i = document.createElement('i'); if (b) i.className = 'f'; el.appendChild(i); });
}
function finishWelcome(demo) {
  S.onboarded = true; if (demo) S.guest = true; persist();
  switchTab('grid');
  if (demo) toast('已进入演示模式，数据可随时在"我的"里清掉');
}

/* ── 屏2 生命方格 ───────────────────────────── */
function lifeMath() {
  const birth = new Date(S.birthday + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysLived = Math.max(0, Math.floor((today - birth) / DAY));
  const daysTotal = Math.round(S.life * 365.25);
  const weekTotal = S.life * 52;
  const weeksLived = Math.min(weekTotal - 1, Math.floor(daysLived / 7));
  return { birth, today, daysLived, daysTotal, weekTotal, weeksLived, todayWeek: weeksLived };
}
function recordMoodForWeek(i, m) {
  // 该周 7 天里任何一天有真实记录 → 用真实记录；否则用演示底色
  for (let d = 0; d < 7; d++) {
    const dt = new Date(m.birth.getTime() + (i * 7 + d) * DAY);
    const r = S.dayRecords[isoOf(dt)];
    if (r && r.mood) return r.mood;
  }
  return S.demoCells[i] || null;
}
function renderGrid() {
  const m = lifeMath();
  const mode = S.currentMode;
  $('mode-1').classList.toggle('on', mode === 1);
  $('mode-2').classList.toggle('on', mode === 2);
  if (mode === 1) {
    $('st1').textContent = m.daysLived.toLocaleString(); $('st1l').textContent = '已用掉的格子';
    $('st2').textContent = (m.daysTotal - m.daysLived).toLocaleString(); $('st2l').textContent = '剩下的日子';
  } else {
    const n = Object.keys(S.dayRecords).length;
    $('st1').textContent = n.toLocaleString(); $('st1l').textContent = '已收集的时刻';
    $('st2').textContent = '还剩很多格'; $('st2l').textContent = '可以继续涂';
  }
  $('life-bar').style.width = Math.min(100, (m.daysLived / m.daysTotal) * 100).toFixed(1) + '%';
  const G = $('grid'); G.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < m.weekTotal; i++) {
    const c = document.createElement('div'); c.className = 'cell';
    let color = i < m.todayWeek ? '#D9D7D1' : (i === m.todayWeek ? 'var(--p600)' : '#EFEFEA');
    if (mode === 2) color = i === m.todayWeek ? 'var(--p600)' : (i < m.todayWeek ? '#EDEBE5' : '#EFEFEA');
    const mood = i < m.todayWeek ? recordMoodForWeek(i, m) : null;
    if (mood === 'n') color = 'var(--nourish)';
    if (mood === 'd') color = 'var(--drain)';
    c.style.background = color;
    c.onclick = () => openCell(i, m);
    frag.appendChild(c);
  }
  G.appendChild(frag);
}
function setMode(v) { S.currentMode = v; persist(); renderGrid(); }

/* ── 屏7 方格详情 + 补记 ─────────────────────── */
let curCell = null;
function openCell(i, m) {
  curCell = { week: i, m };
  let recDate = null, rec = null;
  for (let d = 6; d >= 0; d--) {
    const dt = new Date(m.birth.getTime() + (i * 7 + d) * DAY);
    const r = S.dayRecords[isoOf(dt)];
    if (r) { recDate = isoOf(dt); rec = r; break; }
  }
  const showDate = recDate || isoOf(new Date(m.birth.getTime() + i * 7 * DAY));
  curCell.date = showDate;
  $('cell-title').textContent = fmtDate(showDate);
  const dt = new Date(showDate + 'T00:00:00');
  const jan1 = new Date(dt.getFullYear(), 0, 1);
  const weekOfYear = Math.ceil(((dt - jan1) / DAY + jan1.getDay() + 1) / 7);
  const age = dt.getFullYear() - m.birth.getFullYear();
  const dayOfYear = Math.ceil((dt - new Date(dt.getFullYear(), 0, 1)) / DAY) + 1;
  $('cell-meta').textContent = `${dt.getFullYear()} 年 · 第 ${weekOfYear} 周 · 你 ${age} 岁这一年的第 ${dayOfYear} 天`;
  const tag = $('cell-mood-tag');
  if (rec && rec.mood === 'n') { tag.style.background = 'var(--nourish-bg)'; tag.style.color = 'var(--nourish-tx)'; tag.innerHTML = '<span class="dot" style="border-color:var(--nourish);width:12px;height:12px"></span>滋养'; }
  else if (rec && rec.mood === 'd') { tag.style.background = 'var(--drain-bg)'; tag.style.color = 'var(--drain-tx)'; tag.innerHTML = '<span class="dot" style="border-color:var(--drain);width:12px;height:12px"></span>耗竭'; }
  else { tag.style.background = 'var(--g100)'; tag.style.color = 'var(--g500)'; tag.innerHTML = '<span class="dot" style="border-color:var(--g400);border-style:dashed;width:12px;height:12px"></span>未标注'; }
  $('cell-content').textContent = rec ? rec.text : '这一天还没有留下记录。空白也是一种样子。';
  $('cell-src').textContent = rec ? `来自当天的${rec.src} · ${rec.time || ''}` : '';
  const w = S.wishes.find(x => x.status === 1 && x.doneAt === showDate);
  $('cell-wish-card').style.display = w ? 'block' : 'none';
  if (w) $('cell-wish').innerHTML = `✓ ${w.content} <span style="font-size:11px;color:var(--g400)">（愿望归档）</span>`;
  go('scr-cell');
}
function openSupplement() {
  $('supp-title').textContent = '补记 ' + fmtDate(curCell.date);
  $('supp-input').value = '';
  openOverlay('sheet-supplement');
}
function saveSupplement() {
  const text = $('supp-input').value.trim();
  const mood = selMoodVal('sheet-supplement');
  if (!text && !mood) { toast('写一句，或者选一个颜色就好'); return; }
  S.dayRecords[curCell.date] = { mood, text: text || '（只标了一个颜色）', time: new Date().toTimeString().slice(0, 5), src: '补记' };
  persist(); closeOverlay('sheet-supplement'); renderGrid();
  openCell(curCell.week, curCell.m); stack.pop(); // 刷新详情
  toast('已存进那天的格子');
}

/* ── 屏3 记录 ───────────────────────────────── */
function todayQuestion() {
  const day = Math.floor(Date.now() / DAY);
  const list = S.questions.length ? S.questions : FALLBACK_QUESTIONS;
  return list[day % list.length];
}
function renderDiary() {
  $('today-question').textContent = todayQuestion();
  $('diary-input').value = ''; $('diary-cnt').textContent = '0';
  document.querySelectorAll('#diary-moods .mood').forEach(x => x.classList.remove('sel'));
  const list = $('diary-list'); list.innerHTML = '';
  S.diary.slice(0, 2).forEach(d => {
    const card = document.createElement('div'); card.className = 'card'; card.style.cssText = 'margin-top:10px;cursor:pointer';
    const tagBg = d.mood === 'n' ? 'var(--nourish-bg)' : d.mood === 'd' ? 'var(--drain-bg)' : 'var(--g100)';
    const tagTx = d.mood === 'n' ? 'var(--nourish-tx)' : d.mood === 'd' ? 'var(--drain-tx)' : 'var(--g500)';
    const tagTx2 = d.mood === 'n' ? '滋养' : d.mood === 'd' ? '耗竭' : '未标注';
    const body = d.risk >= 2 ? '（这条内容已停止展示）' : d.content;
    card.innerHTML = `<div style="font-size:13px;color:var(--g400);margin-bottom:6px">${fmtDate(d.date)} · <span class="tag" style="background:${tagBg};color:${tagTx};height:22px;font-size:11px">${tagTx2}</span></div><div style="font-size:15px;color:var(--g800);line-height:1.6"></div>`;
    card.querySelector('div:last-child').textContent = body;
    card.onclick = () => openDiaryDetail(d.id);
    list.appendChild(card);
  });
  if (!S.diary.length) list.innerHTML = '<div style="font-size:13px;color:var(--g400);text-align:center;margin-top:16px">还没有记录。第一条，想到什么写什么。</div>';
}
$('diary-input') && document.addEventListener('input', (e) => {
  // 字数实时计数：日记输入框 + 补记输入框
  if (e.target.id === 'diary-input') $('diary-cnt').textContent = e.target.value.length;
  if (e.target.id === 'supp-input') { const c = e.target.parentElement.querySelector('.cnt'); if (c) c.textContent = e.target.value.length; }
});
let curMood = '';
function selMood(el) { el.parentElement.querySelectorAll('.mood').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); curMood = el.dataset.mood; }
async function saveDiary() {
  const content = $('diary-input').value.trim();
  if (!content && !curMood) { toast('想到什么写什么，不写也没关系'); return; }
  let risk = 0;
  try {
    const r = await api('/api/v1/moderation/check', { method: 'POST', body: JSON.stringify({ text: content }) });
    risk = r.level;
  } catch (e) {
    risk = LOCAL_WORDS.l2.some(w => content.includes(w)) ? 2 : (LOCAL_WORDS.l1.some(w => content.includes(w)) ? 1 : 0);
  }
  const now = new Date();
  const entry = { id: ++S.nextId, date: isoOf(now), mood: curMood, content, time: now.toTimeString().slice(0, 5), q: todayQuestion(), risk };
  S.diary.unshift(entry);
  if (moodOf(entry)) S.dayRecords[entry.date] = { mood: entry.mood, text: content, time: entry.time, src: '日记' };
  persist(); renderDiary(); renderGrid();
  if (risk >= 2) { $('crisis-call').textContent = '拨打 ' + S.hotline; $('crisis-call').onclick = () => { location.href = 'tel:' + S.hotline; }; openOverlay('modal-crisis'); }
  else toast(moodOf(entry) ? '已存进今天的格子' : '已保存');
}
function moodOf(e) { return e.mood === 'n' || e.mood === 'd' ? e.mood : null; }
let curDiaryId = null;
function openDiaryDetail(id) {
  const d = S.diary.find(x => x.id === id); if (!d) return;
  curDiaryId = id;
  $('dd-title').textContent = fmtDate(d.date);
  const tag = $('dd-tag');
  if (d.mood === 'n') { tag.style.background = 'var(--nourish-bg)'; tag.style.color = 'var(--nourish-tx)'; tag.innerHTML = '<span class="dot" style="border-color:var(--nourish);width:12px;height:12px"></span>滋养'; }
  else if (d.mood === 'd') { tag.style.background = 'var(--drain-bg)'; tag.style.color = 'var(--drain-tx)'; tag.innerHTML = '<span class="dot" style="border-color:var(--drain);width:12px;height:12px"></span>耗竭'; }
  else { tag.style.background = 'var(--g100)'; tag.style.color = 'var(--g500)'; tag.innerHTML = '<span class="dot" style="border-color:var(--g400);border-style:dashed;width:12px;height:12px"></span>未标注'; }
  $('dd-content').textContent = d.risk >= 2 ? '（这条内容已停止展示。如果痛苦难以承受，请拨打 ' + S.hotline + '）' : d.content;
  $('dd-time').textContent = `写于 ${d.time} · 仅存于这台手机`;
  go('scr-diary-detail');
}
function deleteDiary() {
  S.diary = S.diary.filter(x => x.id !== curDiaryId);
  persist(); closeOverlay('modal-delete'); back(); renderDiary(); renderGrid();
  toast('已删除');
}

/* ── 屏4 愿望 ───────────────────────────────── */
let curWishId = null;
function renderWishes() {
  const list = $('wish-list'); list.innerHTML = '';
  S.wishes.filter(w => w.status !== 2).forEach(w => {
    const row = document.createElement('div'); row.className = 'wish' + (w.status === 1 ? ' done' : '');
    const sub = w.status === 1 ? `${fmtDate(w.doneAt)}完成${w.doneNote ? ' · ' + w.doneNote : ''}` : (w.note || '');
    row.innerHTML = `<div class="ck"></div><div><div class="w-t"></div>${sub ? `<div class="w-s"></div>` : ''}</div>${w.status === 0 ? '<div class="more" title="悄悄放弃">···</div>' : ''}`;
    row.querySelector('.w-t').textContent = w.content;
    if (sub) row.querySelector('.w-s').textContent = sub;
    row.querySelector('.ck').onclick = () => toggleWish(w.id);
    const more = row.querySelector('.more');
    if (more) more.onclick = () => { curWishId = w.id; openOverlay('modal-abandon'); };
    list.appendChild(row);
  });
}
function toggleWish(id) {
  const w = S.wishes.find(x => x.id === id); if (!w) return;
  if (w.status === 0) {
    w.status = 1; w.doneAt = isoOf(new Date());
    S.dayRecords[w.doneAt] = S.dayRecords[w.doneAt] || { mood: 'n', text: '✓ ' + w.content, time: '', src: '愿望归档' };
    toast('存进了今天的格子');
  } else { w.status = 0; delete w.doneAt; }
  persist(); renderWishes(); renderGrid();
}
function openAddWish() { $('wish-input').value = ''; openOverlay('sheet-add-wish'); }
function saveWish() {
  const v = $('wish-input').value.trim();
  if (!v) { toast('写下一件想体验的小事'); return; }
  S.wishes.push({ id: ++S.nextId, content: v, status: 0 });
  persist(); closeOverlay('sheet-add-wish'); renderWishes();
  toast('它会安静地待在清单里等你');
}
function abandonWish() {
  const w = S.wishes.find(x => x.id === curWishId);
  if (w) w.status = 2;
  persist(); closeOverlay('modal-abandon'); renderWishes();
  toast('它只是安静地待到"我的"里去了');
}

/* ── 屏6 我的 ───────────────────────────────── */
function renderMe() {
  $('me-name').textContent = '路过的旅人-' + S.nameNo;
  const days = Math.max(1, Math.floor((Date.now() - S.installedAt) / DAY) + 1);
  const recDays = Object.keys(S.dayRecords).length;
  $('me-sub').textContent = `来到生格的第 ${days} 天 · 记录了 ${recDays} 天`;
  $('cv-viewmode').textContent = (S.defaultView === 2 ? '收集' : '倒计时') + ' ›';
  $('cv-birthday').textContent = S.birthday ? '已设置 ›' : '未设置 ›';
  $('cv-sync').textContent = (S.sync ? '已开启' : '未开启') + ' ›';
  const prog = recDays % 30;
  $('cv-snapshot').textContent = `${prog}/30`;
  $('snap-progress').textContent = `${prog} / 30 天`;
  $('snap-bar').style.width = (prog / 30 * 100) + '%';
  const sl = $('snapshot-list'); sl.innerHTML = '';
  S.snapshots.forEach(s => {
    const c = document.createElement('div'); c.className = 'card'; c.style.cssText = 'margin-bottom:10px;cursor:pointer';
    c.innerHTML = `<div style="font-size:13px;color:var(--g400);margin-bottom:4px">${s.date} · 第 ${s.no} 份</div><div style="font-size:15px;color:var(--g800);line-height:1.6"></div>`;
    c.lastChild.textContent = '"' + s.text + '"';
    c.onclick = () => toast('快照可以导出为图片（内测版即将开放）');
    sl.appendChild(c);
  });
}
function openDefaultView() {
  document.querySelectorAll('#sheet-default-view .opt').forEach(o => o.classList.toggle('sel', +o.dataset.v === S.defaultView));
  openOverlay('sheet-default-view');
}
function saveDefaultView() {
  const sel = document.querySelector('#sheet-default-view .opt.sel');
  S.defaultView = +sel.dataset.v; persist(); closeOverlay('sheet-default-view'); renderMe();
}
function confirmDeleteAll() { openOverlay('modal-delete-all'); }
function deleteAll() {
  localStorage.removeItem('sg_state_v1');
  S = seedState(); S.onboarded = false; S.dayRecords = {}; S.diary = []; S.wishes = []; S.demoCells = {};
  persist(); closeOverlay('modal-delete-all');
  show('scr-welcome'); toast('全部数据已删除');
}

/* ── 屏12 生日与预期寿命 ─────────────────────── */
let leVal = 80;
function previewBirthday() {}
function renderBirthday() {
  $('birthday-input').value = S.birthday; leVal = S.life;
  updateSlider();
}
function updateSlider() {
  $('le-num').textContent = leVal;
  const pct = (leVal - 60) / 40 * 100;
  const sl = $('le-slider');
  sl.querySelector('.fill').style.width = pct + '%';
  sl.querySelector('.knob').style.left = pct + '%';
}
(function initSlider() {
  const sl = $('le-slider');
  function onMove(e) {
    const r = sl.getBoundingClientRect();
    const x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width;
    leVal = Math.round(Math.min(100, Math.max(60, 60 + x * 40)));
    updateSlider();
  }
  sl.addEventListener('mousedown', (e) => { onMove(e); const mv = (ev) => onMove(ev); const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); });
  sl.addEventListener('touchstart', onMove); sl.addEventListener('touchmove', onMove);
})();
function saveBirthday() {
  S.birthday = $('birthday-input').value || S.birthday;
  S.life = leVal; persist(); renderGrid(); back();
  toast('已保存。生日只存在这台手机里。');
}

/* ── 屏13 云同步 ────────────────────────────── */
async function enableSync() {
  try {
    const r = await api('/api/v1/auth/guest', { method: 'POST', body: JSON.stringify({}) });
    S.sync = true; S.anonId = r.anonId; persist(); renderMe();
    toast('已开启（匿名账号 ' + r.anonId + '）'); back();
  } catch (e) { toast('后端未启动，无法开启同步（数据仍安全在本机）'); }
}

/* ── 屏14 导出 ──────────────────────────────── */
function download(name, url) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
function exportJSON() {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  download('shengge-backup-' + isoOf(new Date()) + '.json', URL.createObjectURL(blob));
  toast('JSON 已导出，归你所有');
}
function exportPoster() {
  const y = new Date().getFullYear();
  const c = document.createElement('canvas'); c.width = 560; c.height = 480;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FAFAF8'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#1C1B19'; ctx.font = '600 22px sans-serif'; ctx.fillText(y + ' · 你的生命格子', 30, 46);
  ctx.fillStyle = '#7C7A74'; ctx.font = '13px sans-serif'; ctx.fillText('生格 · 过一天，多一天', 30, 70);
  const start = new Date(y, 0, 1), cols = 26, cell = 18, gap = 3;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (let d = new Date(start); d.getFullYear() === y; d = new Date(d.getTime() + DAY)) {
    const i = Math.round((d - start) / DAY);
    const x = 30 + (i % cols) * (cell + gap), yy = 92 + Math.floor(i / cols) * (cell + gap);
    const r = S.dayRecords[isoOf(d)];
    ctx.fillStyle = r && r.mood === 'n' ? '#6F9E7C' : r && r.mood === 'd' ? '#C2706B' : (d.getTime() === today.getTime() ? '#477069' : (d < today ? '#E4E2DC' : '#EFEFEA'));
    ctx.fillRect(x, yy, cell, cell);
  }
  download(`shengge-poster-${y}.png`, c.toDataURL('image/png'));
  toast('海报已生成');
}

/* ── 启动 ───────────────────────────────────── */
async function boot() {
  drawMiniGrid($('welcome-logo')); drawMiniGrid($('me-logo'), [1,1,0,0, 1,1,1,0, 1,1,1,1]);
  $('poster-sub').textContent = new Date().getFullYear() + ' · 你的生命格子';
  // 拉取配置（后端在线时生效；离线静默降级）
  try {
    const qs = await api('/api/v1/config/questions');
    if (Array.isArray(qs) && qs.length) S.questions = qs.map(q => q.content);
  } catch (e) {}
  try {
    const hs = await api('/api/v1/config/hotline');
    if (Array.isArray(hs) && hs.length) S.hotline = hs[0].phone;
  } catch (e) {}
  $('crisis-hotline').textContent = S.hotline;
  renderBirthday();
  if (!S.onboarded) show('scr-welcome');
  else switchTab('grid');
}
boot();

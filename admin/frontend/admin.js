/* 「生格」管理后台 · 逻辑层：接真实 API，后端离线时降级为演示数据（与原型一致） */
'use strict';
const API = location.protocol.startsWith('http') ? '' : 'http://127.0.0.1:8102';

const DEMO = {
  dashboard: {
    kpis: { totalUsers: 1284, weekNew: 212, northStar: 37.2, northStarDelta: 2.1, crashRate: 0.18, todayHighRisk: 6 },
    weekly: [52, 61, 48, 74, 88, 100, 70],
    mood: { nourish: 61, drain: 24, unlabeled: 15 },
  },
  questions: [
    { id: 1, content: '今天哪一刻，你觉得活着还不错？', category: '感知当下', status: 'active', hits30d: 3412 },
    { id: 2, content: '最近什么事在消耗你？', category: '消耗与滋养', status: 'active', hits30d: 2988 },
    { id: 3, content: '如果把今天的疲惫画成天气，是什么天气？', category: '消耗与滋养', status: 'active', hits30d: 1204 },
    { id: 4, content: '你上一次大笑是什么时候，因为什么？', category: '回忆与意义', status: 'review', hits30d: 986 },
    { id: 5, content: '（示例）你为什么还不努力？', category: '', status: 'offline', hits30d: 0 },
  ],
  hotlines: { lastCheck: '2026-10-01', nextCheck: '2027-01-01', list: [
    { id: 1, region: '全国', name: '心理援助热线', phone: '12356', hours: '24 小时', status: 'valid' },
    { id: 2, region: '北京', name: '心理危机干预中心', phone: '010-82951332', hours: '24 小时', status: 'valid' },
    { id: 3, region: '示例', name: '（示例热线）', phone: '000-0000', hours: '—', status: 'invalid' },
  ]},
  words: [
    { id: 1, masked: 'w***1', levelLabel: '高危 L2', category: '自伤类', response: '立即危机弹窗', status: 'active' },
    { id: 2, masked: 'w***7', levelLabel: '高危 L2', category: '自伤类', response: '立即危机弹窗', status: 'active' },
    { id: 3, masked: 'p***3', levelLabel: '疑似 L1', category: '绝望情绪类', response: '静默观察计数', status: 'reviewing' },
  ],
  risk: [
    { time: '10-16 00:12', level: 'L2 高危', lv: 2, category: '自伤类', action: '危机弹窗 + 热线转介', status: '已处理（端侧自动）' },
    { time: '10-15 23:41', level: 'L2 高危', lv: 2, category: '自伤类', action: '危机弹窗 + 热线转介', status: '已处理（端侧自动）' },
    { time: '10-15 22:07', level: 'L1 疑似', lv: 1, category: '绝望情绪类', action: '静默观察计数', status: '观察中' },
    { time: '10-15 21:55', level: 'L1 疑似', lv: 1, category: '绝望情绪类', action: '静默观察计数', status: '观察中' },
  ],
  audit: [
    { time: '10-15 18:20', actor: '运营员 A', action: '题库下架（违反文案宪法）', object: '提问 #E-0902', result: '成功 · 复核人 B' },
    { time: '10-15 18:19', actor: '运营员 B', action: '复核通过（下架）', object: '提问 #E-0902', result: '成功' },
    { time: '10-14 09:03', actor: '系统', action: '季度热线核验提醒', object: 'hotline_config', result: '已推送' },
    { time: '10-12 14:47', actor: '运营员 A', action: '敏感词新增（L1）', object: 'p***3', result: '成功 · 复核人 C' },
  ],
  users: [
    { anonId: 'a***4821', registeredAt: '10-01', sync: '未开启', risk: '正常', account: '正常' },
    { anonId: 'a***7702', registeredAt: '10-03', sync: '已开启', risk: '正常', account: '正常' },
    { anonId: 'a***0093', registeredAt: '09-28', sync: '未开启', risk: 'L2 曾命中', account: '正常' },
    { anonId: 'a***1145', registeredAt: '09-15', sync: '—', risk: '—', account: '注销中 · 余 9 天' },
  ],
};

let D = JSON.parse(JSON.stringify(DEMO));
let OFFLINE = false;
let TOKEN = localStorage.getItem('sg_admin_token') || '';

async function api(path, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  try {
    const r = await fetch(API + path, Object.assign({}, opts, { headers }));
    const j = await r.json();
    if (r.status === 401) { TOKEN = ''; localStorage.removeItem('sg_admin_token'); showLogin('会话已过期，请重新登录'); throw new Error('unauthorized'); }
    if (j.code !== 0) throw new Error(j.msg || ('HTTP ' + r.status));
    OFFLINE = false;
    document.getElementById('env-tag').textContent = '内测环境 · 已连接';
    return j.data;
  } catch (e) {
    if (e.message === 'unauthorized') throw e;
    OFFLINE = true;
    document.getElementById('env-tag').textContent = '内测环境（离线演示）';
    return null;
  }
}
/* ── 登录门 ──────────────────────────────────── */
function showLogin(msg) {
  document.getElementById('lg-err').textContent = msg || '';
  document.getElementById('login-dim').classList.add('on');
  setTimeout(() => document.getElementById('lg-user').focus(), 50);
}
function hideLogin() { document.getElementById('login-dim').classList.remove('on'); }
async function doLogin() {
  const username = document.getElementById('lg-user').value.trim();
  const password = document.getElementById('lg-pass').value;
  if (!username || !password) { document.getElementById('lg-err').textContent = '请输入用户名和密码'; return; }
  try {
    const r = await fetch(API + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const j = await r.json();
    if (j.code !== 0) { document.getElementById('lg-err').textContent = j.msg || '登录失败'; return; }
    TOKEN = j.data.token;
    localStorage.setItem('sg_admin_token', TOKEN);
    document.getElementById('who-name').textContent = j.data.user;
    hideLogin();
    loadDashboard();
  } catch (e) { document.getElementById('lg-err').textContent = '无法连接后台服务（可离线演示）'; }
}
async function doLogout() {
  try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); } catch (e) {}
  TOKEN = ''; localStorage.removeItem('sg_admin_token');
  showLogin('已退出');
}
async function boot() {
  // 有令牌 → 校验；无令牌 → 探测后台是否在线（在线则强制登录，离线则进入演示模式）
  if (TOKEN) {
    try {
      const d = await api('/api/admin/dashboard');
      if (d) { loadDashboard(); return; }
    } catch (e) { if (e.message === 'unauthorized') return; }
    loadDashboard(); return; // 离线演示
  }
  try {
    const r = await fetch(API + '/api/admin/dashboard');
    if (r.status === 401) { showLogin('请登录运营后台'); return; }
  } catch (e) { /* 后端不在线 → 离线演示 */ }
  loadDashboard();
}
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const badge = (cls, txt) => `<span class="badge ${cls}">${esc(txt)}</span>`;
const STATUS_BADGE = { active: ['b-ok', '上架'], review: ['b-warn', '待复审'], offline: ['b-err', '已下架·违反文案宪法'] };

/* ── 侧栏导航 ────────────────────────────────── */
const TITLES = { 'p-dashboard': '数据看板', 'p-question': '轻提问题库', 'p-hotline': '热线配置核验', 'p-words': '敏感词库', 'p-risk': '风控事件（脱敏）', 'p-audit': '操作审计日志', 'p-user': '用户管理（匿名）' };
const LOADERS = { 'p-dashboard': loadDashboard, 'p-question': loadQuestions, 'p-hotline': loadHotlines, 'p-words': loadWords, 'p-risk': loadRisk, 'p-audit': loadAudit, 'p-user': loadUsers };
document.querySelectorAll('.nitem').forEach(n => {
  n.addEventListener('click', () => {
    document.querySelectorAll('.nitem').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('.page').forEach(x => x.classList.remove('on'));
    n.classList.add('on');
    const id = n.dataset.p;
    document.getElementById(id).classList.add('on');
    document.getElementById('ptitle').textContent = TITLES[id];
    LOADERS[id] && LOADERS[id]();
  });
});

/* ── 弹窗 ────────────────────────────────────── */
let modalOk = null;
function openModal(title, bodyHtml, onOk, okLabel) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-ok').textContent = okLabel || '保存';
  modalOk = onOk;
  document.getElementById('modal').classList.add('on');
}
function closeModal() { document.getElementById('modal').classList.remove('on'); modalOk = null; }
document.getElementById('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.getElementById('modal-ok').addEventListener('click', () => { if (modalOk) modalOk(); });
const mv = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

/* ── 看板 ────────────────────────────────────── */
async function loadDashboard() {
  const d = await api('/api/admin/dashboard') || DEMO.dashboard;
  const k = d.kpis;
  document.getElementById('kpi4').innerHTML = `
    <div class="kpi"><div class="v">${k.totalUsers.toLocaleString()}</div><div class="l">累计用户（内测）</div><div class="d up">周新增 +${k.weekNew}</div></div>
    <div class="kpi"><div class="v">${k.northStar}%</div><div class="l">北极星 · 30天记录≥10天占比</div><div class="d up">较上周 +${k.northStarDelta}pt</div></div>
    <div class="kpi"><div class="v">${k.crashRate}%</div><div class="l">崩溃率</div><div class="d flat">门禁 &lt;0.5%</div></div>
    <div class="kpi"><div class="v">${k.todayHighRisk}</div><div class="l">今日风控高危事件（脱敏）</div><div class="d dn">均已弹窗转介</div></div>`;
  const names = ['周一', '周二', '周三', '周四', '周五', '周六', '今日'];
  const max = Math.max(...d.weekly);
  document.getElementById('week-chart').innerHTML = d.weekly.map((v, i) =>
    `<div class="col"><i style="height:${Math.round(v / max * 100)}%;background:${i === 4 ? 'var(--viz2)' : 'var(--viz1)'}"></i><span>${names[i]}</span></div>`).join('');
  const m = d.mood;
  document.getElementById('mood-table').innerHTML = `
    <tr><td>滋养</td><td style="width:45%"><div class="bar"><i style="width:${m.nourish}%;background:var(--viz1)"></i></div></td><td>${m.nourish}%</td></tr>
    <tr><td>耗竭</td><td><div class="bar"><i style="width:${m.drain}%;background:var(--viz4)"></i></div></td><td>${m.drain}%</td></tr>
    <tr><td>未标注</td><td><div class="bar"><i style="width:${m.unlabeled}%;background:var(--viz5)"></i></div></td><td>${m.unlabeled}%</td></tr>`;
}

/* ── 题库 ────────────────────────────────────── */
async function loadQuestions() {
  const list = await api('/api/admin/questions') || DEMO.questions;
  D.questions = list;
  renderQuestions();
}
function renderQuestions() {
  const kw = (mv('q-search') || '').toLowerCase();
  const list = D.questions.filter(q => !kw || q.content.toLowerCase().includes(kw));
  const active = D.questions.filter(q => q.status === 'active').length;
  document.getElementById('q-count').textContent = `每日轻提问（当前 ${D.questions.length} 条，上架 ${active} 条）`;
  document.getElementById('q-table').innerHTML = '<tr><th>提问</th><th>分类</th><th>状态</th><th>近30天命中</th><th>操作</th></tr>' +
    (list.length ? list.map(q => {
      const [cls, txt] = STATUS_BADGE[q.status] || ['b-g', q.status];
      const act = q.status === 'review'
        ? `<button class="btn btn-s" onclick="reviewQuestion(${q.id})">复审</button>`
        : q.status === 'offline'
          ? `<button class="btn btn-ghost" onclick="toast('下架原因：违反文案宪法第 1 条（不得制造焦虑/评判用户）')">查看原因</button>`
          : `<button class="btn btn-ghost" onclick="editQuestion(${q.id})">编辑</button>`;
      return `<tr><td>${esc(q.content)}</td><td>${esc(q.category || '—')}</td><td>${badge(cls, txt)}</td><td>${q.hits30d ? q.hits30d.toLocaleString() : '—'}</td><td>${act}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">无匹配结果</td></tr>');
}
function openQuestionModal() {
  openModal('新增提问',
    `<label>提问内容（文案须过《文案宪法》白名单）</label><textarea id="f-content" placeholder="如：今天哪一刻，你觉得活着还不错？"></textarea>
     <label>分类</label><select id="f-cat"><option>感知当下</option><option>消耗与滋养</option><option>回忆与意义</option></select>`,
    async () => {
      const content = mv('f-content'); if (!content) { toast('请填写提问内容'); return; }
      const r = await api('/api/admin/questions', { method: 'POST', body: JSON.stringify({ content, category: mv('f-cat') }) });
      closeModal(); r ? (toast('已新增，状态：待复审'), loadQuestions()) : (DEMO.questions.push({ id: 99, content, category: mv('f-cat'), status: 'review', hits30d: 0 }), renderQuestions(), toast('离线演示：已加入本地列表'));
    }, '新增');
}
function editQuestion(id) {
  const q = D.questions.find(x => x.id === id); if (!q) return;
  openModal('编辑提问',
    `<label>提问内容</label><textarea id="f-content">${esc(q.content)}</textarea>
     <label>分类</label><select id="f-cat"><option${q.category === '感知当下' ? ' selected' : ''}>感知当下</option><option${q.category === '消耗与滋养' ? ' selected' : ''}>消耗与滋养</option><option${q.category === '回忆与意义' ? ' selected' : ''}>回忆与意义</option></select>
     <label>状态</label><select id="f-status"><option value="active"${q.status === 'active' ? ' selected' : ''}>上架</option><option value="review"${q.status === 'review' ? ' selected' : ''}>待复审</option><option value="offline"${q.status === 'offline' ? ' selected' : ''}>下架</option></select>`,
    async () => {
      const body = JSON.stringify({ content: mv('f-content'), category: mv('f-cat'), status: mv('f-status') });
      const r = await api('/api/admin/questions/' + id, { method: 'PUT', body });
      closeModal();
      if (r) { Object.assign(q, JSON.parse(body)); toast('已保存并记入审计日志'); loadQuestions(); }
      else { toast('离线演示：未保存到服务端'); }
    });
}
async function reviewQuestion(id) {
  const r = await api('/api/admin/questions/' + id, { method: 'PUT', body: JSON.stringify({ status: 'active' }) });
  r ? (toast('复审通过，已上架 · 记入审计日志'), loadQuestions()) : (D.questions.find(x => x.id === id).status = 'active', renderQuestions());
}

/* ── 热线 ────────────────────────────────────── */
async function loadHotlines() {
  const d = await api('/api/admin/hotlines') || DEMO.hotlines;
  D.hotlines = d;
  document.getElementById('hotline-desc').textContent = `App 危机弹窗数据源 · 上次核验 ${d.lastCheck} · 下次核验 ${d.nextCheck}`;
  document.getElementById('hotline-table').innerHTML = '<tr><th>地区</th><th>名称</th><th>号码</th><th>时段</th><th>状态</th><th>操作</th></tr>' +
    d.list.map(h => `<tr><td>${esc(h.region)}</td><td>${esc(h.name)}</td><td><b>${esc(h.phone)}</b></td><td>${esc(h.hours)}</td><td>${h.status === 'valid' ? badge('b-ok', '有效') : badge('b-err', '失效·待替换')}</td><td>${h.status === 'valid' ? `<button class="btn btn-ghost" onclick="checkRecord('${esc(h.phone)}')">核验记录</button>` : `<button class="btn btn-s" onclick="replaceHotline(${h.id})">替换</button>`}</td></tr>`).join('');
}
function checkRecord(phone) { openModal('核验记录', `<div style="font-size:13px;color:var(--g600);line-height:1.8">号码 <b>${esc(phone)}</b><br>上次人工核验：2026-10-01（通过）<br>核验方式：工作时段试拨 + 语音菜单确认<br>下次核验：2027-01-01（写入运维日历）</div>`, closeModal, '知道了'); }
function replaceHotline(id) {
  openModal('替换失效热线',
    `<label>地区</label><input id="f-region" placeholder="如：上海">
     <label>名称</label><input id="f-name" placeholder="如：心理援助热线">
     <label>号码</label><input id="f-phone" placeholder="如：021-962525">
     <label>时段</label><input id="f-hours" value="24 小时">`,
    async () => {
      const phone = mv('f-phone'); if (!phone) { toast('请填写号码'); return; }
      const body = JSON.stringify({ region: mv('f-region') || '全国', name: mv('f-name') || '未命名热线', phone, hours: mv('f-hours'), status: 'valid' });
      const r = await api('/api/admin/hotlines/' + id, { method: 'PUT', body });
      closeModal();
      r ? (toast('已替换 · 记入审计日志'), loadHotlines()) : toast('离线演示：未保存到服务端');
    }, '替换');
}

/* ── 词库 ────────────────────────────────────── */
async function loadWords() {
  const list = await api('/api/admin/words') || DEMO.words;
  D.words = list; renderWords();
}
function renderWords() {
  const kw = (mv('w-search') || '').toLowerCase();
  const list = D.words.filter(w => !kw || w.masked.toLowerCase().includes(kw) || (w.category || '').includes(kw));
  document.getElementById('w-table').innerHTML = '<tr><th>词条（脱敏展示）</th><th>级别</th><th>响应</th><th>状态</th><th>操作</th></tr>' +
    (list.length ? list.map(w => {
      const lv = w.levelLabel.includes('L2') ? badge('b-err', w.levelLabel) : badge('b-warn', w.levelLabel);
      const st = w.status === 'active' ? badge('b-ok', '生效') : w.status === 'reviewing' ? badge('b-warn', '复核中') : badge('b-g', w.status);
      const act = w.status === 'reviewing' ? `<button class="btn btn-s" onclick="approveWord(${w.id})">复核</button>` : `<button class="btn btn-ghost" onclick="toast('编辑需双人复核：操作将记入审计日志并通知复核人')">编辑</button>`;
      return `<tr><td>${esc(w.masked)}</td><td>${lv}</td><td>${esc(w.response)}</td><td>${st}</td><td>${act}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">无匹配结果</td></tr>');
}
function openWordModal() {
  openModal('新增词条',
    `<label>命中词（多个用逗号分隔，提交后脱敏展示）</label><textarea id="f-patterns" placeholder="词A, 词B"></textarea>
     <label>级别</label><select id="f-level"><option value="1">疑似 L1（静默观察计数）</option><option value="2">高危 L2（立即危机弹窗）</option></select>
     <label>类别</label><select id="f-cat2"><option>自伤类</option><option>绝望情绪类</option></select>`,
    async () => {
      const patterns = mv('f-patterns').split(/[,，]/).map(s => s.trim()).filter(Boolean);
      if (!patterns.length) { toast('请填写至少一个命中词'); return; }
      const body = JSON.stringify({ patterns, level: +mv('f-level'), category: mv('f-cat2') });
      const r = await api('/api/admin/words', { method: 'POST', body });
      closeModal();
      r ? (toast('已新增（复核中）· 记入审计日志'), loadWords()) : toast('离线演示：未保存到服务端');
    }, '新增');
}
async function approveWord(id) {
  const r = await api('/api/admin/words/' + id, { method: 'PUT', body: JSON.stringify({ status: 'active' }) });
  r ? (toast('复核通过，已生效 · 记入审计日志'), loadWords()) : (D.words.find(x => x.id === id).status = 'active', renderWords());
}
async function syncWords() {
  const r = await api('/api/admin/words/sync', { method: 'POST', body: '{}' });
  toast(r ? `已打包下发端侧（${r.count} 条）· 记入审计日志` : '离线演示：未同步');
}

/* ── 风控 / 审计 / 用户 ───────────────────────── */
async function loadRisk() {
  const list = await api('/api/admin/risk') || DEMO.risk;
  D.risk = list;
  document.getElementById('risk-table').innerHTML = '<tr><th>时间</th><th>级别</th><th>命中类别</th><th>处理动作</th><th>状态</th></tr>' +
    list.map(r => `<tr><td>${esc(r.time)}</td><td>${r.lv >= 2 ? badge('b-err', r.level) : badge('b-warn', r.level)}</td><td>${esc(r.category)}</td><td>${esc(r.action)}</td><td>${r.lv >= 2 ? badge('b-ok', r.status) : badge('b-g', r.status)}</td></tr>`).join('');
}
async function loadAudit() {
  const list = await api('/api/admin/audit') || DEMO.audit;
  D.audit = list;
  document.getElementById('audit-table').innerHTML = '<tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>结果</th></tr>' +
    list.map(a => `<tr><td>${esc(a.time)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.object)}</td><td>${badge(a.result.includes('推送') ? 'b-info' : 'b-ok', a.result)}</td></tr>`).join('');
}
async function loadUsers() {
  const list = await api('/api/admin/users') || DEMO.users;
  D.users = list; renderUsers();
}
function renderUsers() {
  const kw = (mv('u-search') || '').toLowerCase();
  const list = D.users.filter(u => !kw || u.anonId.toLowerCase().includes(kw) || (u.account || '').includes(kw) || (u.risk || '').includes(kw));
  document.getElementById('user-table').innerHTML = '<tr><th>匿名 ID</th><th>注册时间</th><th>云同步</th><th>风控状态</th><th>账号状态</th><th>操作</th></tr>' +
    (list.length ? list.map(u => {
      const sync = u.sync === '已开启' ? badge('b-info', u.sync) : u.sync === '未开启' ? badge('b-g', u.sync) : esc(u.sync);
      const risk = u.risk === '正常' ? badge('b-g', '正常') : u.risk === '—' ? '—' : badge('b-err', u.risk);
      const acc = u.account === '正常' ? badge('b-ok', '正常') : badge('b-warn', u.account);
      return `<tr><td>${esc(u.anonId)}</td><td>${esc(u.registeredAt)}</td><td>${sync}</td><td>${risk}</td><td>${acc}</td><td><button class="btn btn-ghost" onclick="toast('仅状态详情：无任何内容查看入口（数据架构上不存在明文）')">仅状态详情</button></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">无匹配结果</td></tr>');
}

/* ── 启动 ────────────────────────────────────── */
boot();

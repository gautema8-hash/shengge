# 「生格」管理后台前后端接口文档

> 版本：v1.0 ｜ 更新：2026-10-16 ｜ 服务：管理后台 API（`admin/backend/server.js`）
> BaseURL：`http://127.0.0.1:8102`（生产环境以实际域名为准，必须 HTTPS 且仅内网/VPN 暴露）
> 前端对应：`admin/frontend/`（Web 实现版）；所有写操作自动写入审计日志
> 本文档所有示例均为真实服务响应

---

## 1. 通用约定

### 1.1 统一响应格式

所有 `/api/admin/*` 接口返回 JSON：

```json
{ "code": 0, "msg": "ok", "data": {} }
```

### 1.2 鉴权

| 项 | 值 |
|----|-----|
| 方式 | `Authorization: Bearer <token>` 请求头 |
| 获取 | `POST /api/admin/login`（凭证：env `SG_ADMIN_USER` / `SG_ADMIN_PASS`，默认 `admin` / `shengg@2026`，**生产必须改**） |
| 有效期 | 8 小时（Redis SETEX；过期/登出后即失效） |
| 免鉴权接口 | `POST /login`、`GET /health`、`GET /ping` |
| 防爆破 | 登录失败 10 次/5 分钟/IP → 429 锁定（并写入审计日志） |

### 1.3 HTTP 状态码

| 状态码 | 场景 | 示例 |
|--------|------|------|
| 200 | 成功 | 见各接口 |
| 400 | 参数缺失/非法（body `code` 固定为 1） | `{"code":1,"msg":"content 必填","data":null}` |
| 401 | 未登录 / 令牌过期 / 凭证错误 | `{"code":401,"msg":"未登录或会话已过期","data":null}` |
| 404 | 资源不存在 | `{"code":404,"msg":"not found","data":null}` |
| 413 | 请求体超 256KB | `{"code":413,"msg":"数据太大","data":null}` |
| 429 | 限流 / 登录锁定 | `{"code":429,"msg":"尝试过于频繁，请 5 分钟后再试","data":null}` |
| 500 | 服务器内部错误（对外脱敏） | `{"code":500,"msg":"服务暂时不可用，请稍后再试","data":null}` |

> 约定：`code` 字段与 HTTP 状态码在 401/404/413/429/500 时一致；通用业务校验失败（400 类）`code=1`、`msg` 给出具体原因。

### 1.4 铁律（接口设计层面强制）

1. 全部写操作自动写入审计日志（操作人=会话用户），**接口无法绕过**
2. 热线"至少保留 1 条有效"——接口层拒绝全下线
3. 用户接口仅暴露"匿名 ID + 状态"，**不存在任何查看用户日记的接口**
4. 敏感词接口只返回脱敏值（`w***1`），命中词 patterns 永不出 API

---

## 2. 接口清单

| # | 方法 | 路径 | 说明 | 鉴权 |
|---|------|------|------|------|
| 1 | POST | `/api/admin/login` | 登录获取会话令牌 | 免（限流内） |
| 2 | POST | `/api/admin/logout` | 登出（令牌立即失效） | 是 |
| 3 | GET | `/api/admin/health` | 探针（存储/缓存模式） | 免（限流内） |
| 4 | GET | `/api/admin/dashboard` | 匿名聚合看板 | 是 |
| 5 | GET | `/api/admin/questions` | 题库全量（含待复审/下架） | 是 |
| 6 | POST | `/api/admin/questions` | 新增提问（默认待复审） | 是 |
| 7 | PUT | `/api/admin/questions/:id` | 编辑/上架/复审/下架 | 是 |
| 8 | GET | `/api/admin/hotlines` | 热线配置（含核验日期） | 是 |
| 9 | POST | `/api/admin/hotlines` | 新增热线 | 是 |
| 10 | PUT | `/api/admin/hotlines/:id` | 编辑/替换/失效 | 是 |
| 11 | GET | `/api/admin/words` | 敏感词库（脱敏视图） | 是 |
| 12 | POST | `/api/admin/words` | 新增词条（自动脱敏+复核中） | 是 |
| 13 | PUT | `/api/admin/words/:id` | 复核通过/退回复核 | 是 |
| 14 | POST | `/api/admin/words/sync` | 词库打包下发端侧 | 是 |
| 15 | GET | `/api/admin/risk` | 风控事件（脱敏） | 是 |
| 16 | GET | `/api/admin/audit` | 操作审计日志 | 是 |
| 17 | GET | `/api/admin/users` | 用户（匿名视图） | 是 |

---

## 3. 接口详情

### 3.1 登录

```
POST /api/admin/login
```

**请求参数（JSON body）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string≤32 | 是 | 用户名 |
| password | string≤64 | 是 | 密码 |

**请求示例**

```bash
curl -X POST http://127.0.0.1:8102/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"shengg@2026"}'
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": { "token": "aef79b4e2acfae29...", "user": "admin" }
}
```

**错误**

| 状态码 | 场景 | 响应 |
|--------|------|------|
| 401 | 用户名或密码错误（统一话术，不泄露哪个字段错） | `{"code":401,"msg":"用户名或密码不正确","data":null}` |
| 429 | 连续失败触发 5 分钟锁定 | `{"code":429,"msg":"尝试过于频繁，请 5 分钟后再试","data":null}` |

> 成功与失败均写审计日志；限流拦截由"系统"账号记录。

---

### 3.2 登出

```
POST /api/admin/logout
```

| 项 | 值 |
|----|-----|
| 请求体 | `{}` |
| 效果 | 当前 Bearer 令牌立即失效（Redis 删除）+ 审计留痕 |

**响应示例（200）**

```json
{ "code": 0, "msg": "ok", "data": { "bye": true } }
```

---

### 3.3 探针

```
GET /api/admin/health
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": { "service": "shengge-admin-api", "time": "2026-10-16T01:19:15.278Z", "storage": "mysql", "cache": "redis" }
}
```

---

### 3.4 数据看板

```
GET /api/admin/dashboard
```

| 项 | 值 |
|----|-----|
| 隐私 | 全部匿名聚合统计，无法回溯个人 |

**响应示例（200，真实值）**

```json
{
  "code": 0, "msg": "ok",
  "data": {
    "kpis": {
      "totalUsers": 1285, "weekNew": 213,
      "northStar": 37.2, "northStarDelta": 2.1,
      "crashRate": 0.18, "todayHighRisk": 7
    },
    "weekly": [52, 61, 48, 74, 88, 100, 70],
    "mood": { "drain": 24, "nourish": 61, "unlabeled": 15 }
  }
}
```

| 字段 | 说明 |
|------|------|
| kpis.totalUsers / weekNew | 累计用户 / 周新增（含 App 端游客注册实时上报） |
| kpis.northStar(+Delta) | 北极星：30 天记录≥10 天用户占比 |
| kpis.crashRate | 崩溃率（门禁 <0.5%） |
| kpis.todayHighRisk | 今日 L2 高危风控事件数（App 端实时上报） |
| weekly | 近 7 日记录创建数（相对值，按天聚合） |
| mood | 情绪标注分布（%）: nourish 滋养 / drain 耗竭 / unlabeled 未标注 |

---

### 3.5 题库 · 查询

```
GET /api/admin/questions
```

**响应示例（200，截取）**

```json
{
  "code": 0, "msg": "ok",
  "data": [
    { "id": 1, "content": "今天哪一刻，你觉得活着还不错？", "category": "感知当下", "status": "active", "hits30d": 3412 },
    { "id": 4, "content": "你上一次大笑是什么时候，因为什么？", "category": "回忆与意义", "status": "review", "hits30d": 986 }
  ]
}
```

| 字段 | 说明 |
|------|------|
| status | `active` 上架 / `review` 待复审 / `offline` 已下架 |
| hits30d | 近 30 天下发命中次数 |

---

### 3.6 题库 · 新增

```
POST /api/admin/questions
```

**请求参数（JSON body）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string≤200 | 是 | 提问内容（须过文案宪法） |
| category | string≤32 | 否 | 默认 `感知当下` |

**请求示例**

```bash
curl -X POST http://127.0.0.1:8102/api/admin/questions \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"content":"今天有没有一件让你微笑的小事？","category":"感知当下"}'
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": { "id": 31, "content": "今天有没有一件让你微笑的小事？", "category": "感知当下", "status": "review", "hits30d": 0 }
}
```

> 新增即"待复审"，**不会自动上架**（双人复核机制）。审计记录：`题库新增（待复审）`。

---

### 3.7 题库 · 编辑/状态变更

```
PUT /api/admin/questions/:id
```

**路径参数**

| 参数 | 说明 |
|------|------|
| id | 题目 ID（数字） |

**请求参数（JSON body，均可选）**

| 字段 | 类型 | 约束 |
|------|------|------|
| content | string≤200 | 新内容 |
| category | string≤32 | 新分类 |
| status | string | 枚举：`active`（上架）/ `review`（待复审）/ `offline`（下架） |

**请求示例**

```bash
curl -X PUT http://127.0.0.1:8102/api/admin/questions/31 \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"status":"active"}'
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": { "id": 31, "content": "今天有没有一件让你微笑的小事？", "category": "感知当下", "status": "active", "hits30d": 0 }
}
```

> 状态变更即时生效：App 端 `/api/v1/config/questions` 下一次读取即包含/排除该题（跨进程对账，已测试验证）。

---

### 3.8 热线 · 查询

```
GET /api/admin/hotlines
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": {
    "list": [
      { "id": 1, "region": "全国", "name": "心理援助热线", "phone": "12356", "hours": "24 小时", "status": "valid", "lastCheck": "2026-10-01", "nextCheck": "2027-01-01" },
      { "id": 3, "region": "示例", "name": "（示例热线）", "phone": "000-0000", "hours": "—", "status": "invalid", "lastCheck": "2026-10-01", "nextCheck": "2027-01-01" }
    ],
    "lastCheck": "2026-10-01",
    "nextCheck": "2027-01-01"
  }
}
```

---

### 3.9 热线 · 新增

```
POST /api/admin/hotlines
```

**请求参数（JSON body）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| phone | string≤32 | 是 | 热线号码 |
| region | string≤32 | 否 | 默认 `全国` |
| name | string≤100 | 否 | 默认 `未命名热线` |
| hours | string≤64 | 否 | 默认 `24 小时` |

**响应示例（200）**：返回新建对象（`status` 固定 `valid`，`lastCheck` 为当日）。

---

### 3.10 热线 · 编辑/失效

```
PUT /api/admin/hotlines/:id
```

**请求参数（JSON body，均可选）**：`region` / `name` / `phone` / `hours` / `status`（枚举 `valid` / `invalid`）

**保护规则（接口级强制）**：将某条置为 `invalid` 时，若该操作会导致有效热线数量为 0 → 拒绝：

```json
{ "code": 400, "msg": "不可下线全部热线：至少保留 1 条有效配置", "data": null }
```

---

### 3.11 敏感词库 · 查询（脱敏视图）

```
GET /api/admin/words
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": [
    { "id": 1, "masked": "w***1", "level": 2, "levelLabel": "高危 L2", "category": "自伤类", "response": "立即危机弹窗", "status": "active" },
    { "id": 3, "masked": "p***3", "level": 1, "levelLabel": "疑似 L1", "category": "绝望情绪类", "response": "静默观察计数", "status": "reviewing" }
  ]
}
```

> **响应中永远没有 `patterns` 字段**——命中词以 AES-256-GCM 加密存于数据库，API 只回脱敏展示值。

---

### 3.12 敏感词库 · 新增

```
POST /api/admin/words
```

**请求参数（JSON body）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| patterns | string[]（每项≤32） | 是 | 命中词数组（提交后立即脱敏展示、加密存储） |
| level | number | 是 | `1` 疑似 L1 / `2` 高危 L2 |
| category | string≤32 | 否 | 默认 `自伤类` |

**请求示例**

```bash
curl -X POST http://127.0.0.1:8102/api/admin/words \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"patterns":["测试词甲","测试词乙"],"level":2,"category":"自伤类"}'
```

**响应示例（200）**

```json
{ "code": 0, "msg": "ok", "data": { "id": 4, "masked": "测***乙", "levelLabel": "高危 L2", "status": "reviewing" } }
```

> 新词 `reviewing`（复核中）也会参与端侧审核兜底（安全优先）；审计记录 `敏感词新增（L2）`。

---

### 3.13 敏感词库 · 复核

```
PUT /api/admin/words/:id
```

**请求参数**：`status`（枚举 `active` 生效 / `reviewing` 退回复核）

**响应示例（200）**

```json
{ "code": 0, "msg": "ok", "data": { "id": 4, "masked": "测***乙", "status": "active" } }
```

---

### 3.14 敏感词库 · 同步到端侧

```
POST /api/admin/words/sync
```

**请求体**：`{}`

**响应示例（200）**

```json
{ "code": 0, "msg": "ok", "data": { "synced": true, "count": 4 } }
```

> 记录审计 `词库同步到端侧`；实际打包分发由端侧更新通道消费（App 本地词库 + 可远程更新）。

---

### 3.15 风控事件（脱敏视图）

```
GET /api/admin/risk
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": [
    { "id": 13, "time": "10-16 02:21", "level": "L2 高危", "lv": 2, "category": "自伤类", "action": "危机弹窗 + 热线转介", "status": "已处理（端侧自动）" },
    { "id": 3, "time": "10-15 22:07", "level": "L1 疑似", "lv": 1, "category": "绝望情绪类", "action": "静默观察计数", "status": "观察中" }
  ]
}
```

> 仅记录：时间、级别、命中类别、处理动作。**不记录、不展示用户原文，不可回溯身份**（产品宪法第 5 条的技术体现）。
> 数据来源：App 端 L2 命中实时上报（`/api/v1/moderation/check`）。

---

### 3.16 操作审计日志

```
GET /api/admin/audit
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": [
    { "id": 6, "time": "10-16 00:48", "actor": "运营员 A", "action": "热线配置变更", "object": "010-82951332", "result": "成功" },
    { "id": 5, "time": "10-16 00:48", "actor": "运营员 A", "action": "题库新增（待复审）", "object": "提问 #31", "result": "成功" }
  ]
}
```

> 只增不改（append-only）；登录/登出/题库/热线/词库/限流拦截全自动留痕；留存 ≥6 个月。

---

### 3.17 用户（匿名视图）

```
GET /api/admin/users
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": [
    { "id": 1, "anonId": "a***4821", "registeredAt": "10-01", "sync": "未开启", "risk": "正常", "account": "正常", "note": "" },
    { "id": 4, "anonId": "a***1145", "registeredAt": "09-15", "sync": "—", "risk": "—", "account": "注销中 · 余 9 天", "note": "注销触发 15 天后物理删除" }
  ]
}
```

> 只有"匿名 ID + 状态"。没有"重置密码""查看记录""强制登出"等侵入性操作——用户主权优先。

---

## 4. 前端对接速查（admin/frontend ↔ API）

| 前端行为 | 调用链 |
|----------|--------|
| 打开后台 | `boot()` 探测 → 401 则弹登录门（离线则进演示模式） |
| 登录 | `doLogin()` → `POST /login` → token 存 localStorage（键 `sg_admin_token`） |
| 页面切换 | 各页 loader → 对应 GET（全部携带 Bearer） |
| 401 处理 | 自动清 token → 重新弹登录门 |
| 写操作 | modal 表单 → POST/PUT → 成功后重载列表 + toast |
| 退出 | `doLogout()` → `POST /logout` → 清 token → 回登录门 |

## 5. 运维备注

- **限流**：后台 120 次/分/IP；登录 10 次/5 分/IP（env `SG_ADMIN_RATE` / `SG_LOGIN_RATE` 可调）
- **多实例**：会话在 Redis，天然支持横向扩容；限流当前为单机窗口（多实例需切 Redis 令牌桶）
- **CORS**：默认放开；生产设 `SG_CORS_ORIGIN=https://后台域名` 收紧
- **静态托管**：`GET /` 返回后台前端（生产 `SG_FRONTEND_DIR` 指向 dist 构建目录）

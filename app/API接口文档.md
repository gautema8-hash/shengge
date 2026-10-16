# 「生格」App 前后端接口文档

> 版本：v1.0 ｜ 更新：2026-10-16 ｜ 服务：App 薄后端（`app/backend/server.js`）
> BaseURL：`http://127.0.0.1:8101`（生产环境以实际域名为准，必须 HTTPS）
> 前端对应：`app/frontend/`（Web 高保真实现）/ 后续 Flutter 客户端按本契约对接
> 契约来源：《生格-技术文档》§5；本文档所有示例均为真实服务响应

---

## 1. 通用约定

### 1.1 统一响应格式

所有 `/api/v1/*` 接口返回 JSON，结构统一：

```json
{ "code": 0, "msg": "ok", "data": {} }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| code | number | `0` 成功；非 0 为业务/HTTP 错误码（与 HTTP 状态码一致） |
| msg  | string | 人读消息，客户端可直接 toast |
| data | object/array/null | 业务数据，失败时为 `null` |

### 1.2 HTTP 状态码

| 状态码 | 场景 | 示例响应 |
|--------|------|----------|
| 200 | 成功 | 见各接口 |
| 400 | 参数缺失/格式有误（body `code` 固定为 1） | `{"code":1,"msg":"accountId/deviceId/blob 必填","data":null}` |
| 404 | 未知路径 | `{"code":404,"msg":"not found","data":null}` |
| 413 | 请求体超限（同步 blob 上限 512KB） | `{"code":413,"msg":"数据太大啦","data":null}` |
| 429 | 触发限流（App 240 次/分/IP；审核 60 次/分/IP） | `{"code":429,"msg":"请求过于频繁，请稍后再试","data":null}` |
| 500 | 服务器内部错误（对外脱敏） | `{"code":500,"msg":"服务暂时不可用，请稍后再试","data":null}` |

> 约定：`code` 字段与 HTTP 状态码在 401/404/413/429/500 时一致；通用业务校验失败（400 类）`code=1`、`msg` 给出具体原因。

### 1.3 通用规则

- 请求体：`Content-Type: application/json`（除静态资源外）
- **鉴权：全部免鉴权**——游客模式是产品架构（本地优先），账号仅在云同步时出现
- 响应头：`Content-Type: application/json; charset=utf-8`；`>1KB` 自动 gzip；
  安全头（nosniff/DENY/no-referrer/CSP）与 `Cache-Control: no-store` 全接口强制
- **隐私红线**：审核接口不保存原文、不回显内容；服务端无任何日记明文表

---

## 2. 接口清单

| # | 方法 | 路径 | 说明 | 鉴权 |
|---|------|------|------|------|
| 1 | GET | `/api/v1/health` | 服务健康与运行模式探针 | 免（且不限流） |
| 2 | POST | `/api/v1/auth/guest` | 注册匿名账号（云同步前置） | 免 |
| 3 | POST | `/api/v1/sync/push` | 上传 E2E 加密增量 blob | 免（accountId 即凭证，内测） |
| 4 | POST | `/api/v1/sync/pull` | 按 rev 拉取加密增量 | 免 |
| 5 | GET | `/api/v1/config/questions` | 轻提问题库下发（仅上架） | 免 |
| 6 | GET | `/api/v1/config/hotline` | 危机援助热线配置下发（仅有效） | 免 |
| 7 | POST | `/api/v1/moderation/check` | 内容审核兜底（分级响应） | 免 |
| 8 | GET | `/ping` · `/robots.txt` · 静态资源 | 探活 / 爬虫策略 / 前端托管 | 免 |

---

## 3. 接口详情

### 3.1 服务健康探针

```
GET /api/v1/health
```

| 项 | 值 |
|----|-----|
| 用途 | 探活 + 运行模式上报（存储/缓存/加密） |
| 限流 | 豁免 |
| 请求参数 | 无 |

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": {
    "service": "shengge-app-api",
    "time": "2026-10-16T01:19:14.991Z",
    "storage": "mysql",
    "cache": "redis",
    "encryption": { "algorithm": "AES-256-GCM", "keySource": "file(secret.key)" }
  }
}
```

| 字段 | 说明 |
|------|------|
| storage | `mysql` 权威存储 / `json` 降级模式 |
| cache | `redis` / `memory` 降级 |
| encryption | 静态加密算法与密钥来源 |

---

### 3.2 注册匿名账号

```
POST /api/v1/auth/guest
```

| 项 | 值 |
|----|-----|
| 用途 | 用户开启云同步时生成匿名身份（无手机号/无邮箱/零 PII） |
| 请求体 | 无（`{}` 即可） |
| 副作用 | 匿名用户写入 `app_user` 表；看板累计用户 +1 |

**请求示例**

```bash
curl -X POST http://127.0.0.1:8101/api/v1/auth/guest \
  -H "Content-Type: application/json" -d '{}'
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": { "accountId": 5, "anonId": "a***9797", "token": "guest-5" }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| accountId | number | 本地同步用的数字 ID（`sync/push·pull` 使用） |
| anonId | string | 匿名显示 ID，格式 `a***XXXX`（后台仅见此） |
| token | string | 内测占位会话标识（生产版将升级为签名令牌） |

---

### 3.3 上传加密增量（云同步）

```
POST /api/v1/sync/push
```

| 项 | 值 |
|----|-----|
| 用途 | 端侧把增量变更打包为 E2E 密文上传；**服务端只存密文且再叠加一层 AES-256-GCM 静态加密** |
| 请求体上限 | 512KB（超限 413） |

**请求参数（JSON body）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| accountId | number | 是 | `auth/guest` 返回的数字 ID |
| deviceId | string≤64 | 是 | 设备标识（端侧生成） |
| blob | string≤512KB | 是 | 端侧加密后的增量数据（Base64/任意字符串），服务端不可解 |

**请求示例**

```bash
curl -X POST http://127.0.0.1:8101/api/v1/sync/push \
  -H "Content-Type: application/json" \
  -d '{"accountId":7,"deviceId":"phone-A","blob":"BASE64_E2E_CIPHER"}'
```

**响应示例（200）**

```json
{ "code": 0, "msg": "ok", "data": { "rev": 1 } }
```

| 字段 | 说明 |
|------|------|
| rev | 该账号单调递增修订号（每账号独立，唯一索引 `uk_acct_rev` 兜底防并发冲突） |

**错误**

| 状态码 | 场景 |
|--------|------|
| 400 | 任一必填字段缺失 |
| 413 | blob 超 512KB |

---

### 3.4 拉取加密增量（换机恢复）

```
POST /api/v1/sync/pull
```

**请求参数（JSON body）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| accountId | number | 是 | 账号 ID |
| rev | number | 否 | 已拥有的最新修订号，默认 0（全量） |

**请求示例**

```bash
curl -X POST http://127.0.0.1:8101/api/v1/sync/pull \
  -H "Content-Type: application/json" -d '{"accountId":7,"rev":0}'
```

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": {
    "blobs": [
      { "deviceId": "phone-A", "blob": "BASE64_E2E_CIPHER", "rev": 1 },
      { "deviceId": "phone-A", "blob": "BASE64_E2E_CIPHER2", "rev": 2 }
    ]
  }
}
```

> 客户端流程：按 rev 升序逐个解密合并（记录类 `last_write_wins`，配置类以服务端为准）。
> 新设备换机：`auth/guest` → `pull(rev=0)` → 端侧用用户口令派生密钥解密。

---

### 3.5 轻提问题库下发

```
GET /api/v1/config/questions
```

| 项 | 值 |
|----|-----|
| 用途 | 每日轻提问数据源；管理后台"上架"的内容即时可见（跨进程对账） |
| 缓存建议 | 客户端缓存 30 天；本地缓存失败时使用内置兜底题库 |

**请求示例**

```bash
curl http://127.0.0.1:8101/api/v1/config/questions
```

**响应示例（200，截取）**

```json
{
  "code": 0, "msg": "ok",
  "data": [
    { "id": 1, "content": "今天哪一刻，你觉得活着还不错？", "category": "感知当下" },
    { "id": 2, "content": "最近什么事在消耗你？", "category": "消耗与滋养" }
  ]
}
```

| 字段 | 说明 |
|------|------|
| id | 题目 ID |
| content | 题目内容（≤200 字，已过文案宪法） |
| category | 分类：感知当下 / 消耗与滋养 / 回忆与意义 |

> 只返回 `status=active` 的题目；`待复审/已下架` 永不下发。

---

### 3.6 危机援助热线配置下发

```
GET /api/v1/config/hotline
```

| 项 | 值 |
|----|-----|
| 用途 | 危机干预弹窗的拨打按钮数据源（产品宪法第 4 条配套） |

**响应示例（200）**

```json
{
  "code": 0, "msg": "ok",
  "data": [
    { "region": "全国", "name": "心理援助热线", "phone": "12356", "hours": "24 小时" },
    { "region": "北京", "name": "心理危机干预中心", "phone": "010-82951332", "hours": "24 小时" }
  ]
}
```

> 仅返回 `status=valid` 的热线；接口层保证**至少保留 1 条有效**（后台无法全下线）。
> 客户端取 `data[0].phone` 渲染"拨打 XXX"按钮（`tel:` 协议）。

---

### 3.7 内容审核兜底

```
POST /api/v1/moderation/check
```

| 项 | 值 |
|----|-----|
| 用途 | 云同步开启时服务端审核兜底；与端侧引擎同款分级逻辑 |
| 限流 | 60 次/分/IP |
| 隐私 | **不保存原文、不回显内容**；L2 命中仅写脱敏风控事件（时间/级别/类别/动作） |

**请求参数（JSON body）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| text | string≤2000 | 是 | 待检文本（日记内容） |

**请求示例**

```bash
curl -X POST http://127.0.0.1:8101/api/v1/moderation/check \
  -H "Content-Type: application/json" -d '{"text":"今天很好"}'
```

**响应示例（200）**

```json
{ "code": 0, "msg": "ok", "data": { "level": 0, "action": "none" } }
```

**分级响应表**

| level | action | 客户端行为 |
|-------|--------|-----------|
| 0 | `none` | 正常保存，不做任何提示 |
| 1 | `silent_observe` | 静默观察计数，**不提示用户**（SOP：疑似不惊扰） |
| 2 | `show_crisis_modal` | 立即弹出危机干预弹窗（固定文案 + 热线转介），该条内容停止展示 |

> 响应体仅含 `level/action` 两个键——无内容回显、无命中词信息（测试已验证）。

---

### 3.8 辅助端点

| 方法 | 路径 | 说明 | 响应 |
|------|------|------|------|
| GET | `/ping` | 轻量探活 | `{"code":0,"msg":"ok","data":{"pong":1760551154991}}` |
| GET | `/robots.txt` | 爬虫策略 | `User-agent: *` / `Disallow: /api/` |
| GET | `/` 及静态资源 | App 前端托管（生产用 dist 构建目录） | HTML/JS/CSS（gzip，HTML `no-cache`，其余 1h） |
| * | 其他任意 `/api/v1/*` | 未知接口 | 404 `{"code":404,"msg":"not found","data":null}` |

### 3.9 安全与合规要点（对接必读）

1. **崩溃/断网**：所有接口无会话依赖，客户端随时断开重试均安全（幂等：push 重复会生成新 rev，客户端以本地 rev 为准）
2. **限流重试**：收到 429 时按指数退避重试（建议 2s/4s/8s），不要高频重试
3. **数据删除**：注销流程为端侧删除 + `sync_blob` 由服务端按 15 天保留策略物理清理
4. **禁止行为**（Code Review 强制项）：任何客户端版本不得把日记明文上传到本后端——`sync/push` 仅接受端侧加密后的密文

# app/backend — 「生格」薄后端（已实现）

职责极薄，只做三件事：加密同步、内容审核兜底、题库/热线配置下发。

## 运行

```bash
node server.js        # 零依赖，Node >= 18
# 默认端口 8101（SG_PORT 可覆盖），同时静态托管 ../frontend
```

## API（前缀 /api/v1，契约 = docs/生格-技术文档.md §5）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/guest` | 生成匿名账号（云同步用） |
| POST | `/sync/push`  | 上传 E2E 加密增量 blob（服务端只存密文） |
| POST | `/sync/pull`  | 按 rev 拉取增量 |
| GET  | `/config/questions` | 轻提问题库下发（仅上架） |
| GET  | `/config/hotline`   | 危机热线配置下发（仅有效） |
| POST | `/moderation/check` | 文本审核兜底（分级返回，不保存原文） |

响应格式统一 `{ "code": 0, "msg": "ok", "data": {} }`。

## 存储与隐私

- 默认 JSON 文件存储：`../../server-data/db.json`（与 admin/backend 共享，后台改题库 → App 下发即时生效）
- **无明文 L3 数据表、无用户画像表**——schema 层面保证服务端不可读用户隐私
- 生产切换 MySQL 8.0 / Redis 5.0：本机已就绪，接入时按 `docs/生格-技术文档.md` §4.2 建 `sync_blob / daily_question / hotline_config` 表

## 冒烟测试（已通过）

- `GET /health`、题库/热线下发、`auth/guest`、`sync/push→pull`、审核分级（L1 静默观察 / L2 危机弹窗转介）

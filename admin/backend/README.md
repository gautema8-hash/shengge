# admin/backend — 「生格」管理后台 API（已实现）

零依赖 Node.js（>=18），与 `../../app/backend` 共享同一份 `server-data/db.json`：
后台修改题库/热线/敏感词 → App 端 `/api/v1/config/*` 下发即时生效。

## 运行

```bash
node server.js    # 默认端口 8102（SG_PORT 可覆盖），同时静态托管 ../frontend
```

## API（前缀 /api/admin）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/dashboard` | 匿名聚合 KPI / 近7日记录数 / 情绪分布 |
| GET·POST | `/questions` · PUT `/questions/:id` | 题库增改、上架/复审/下架（写审计） |
| GET·POST | `/hotlines` · PUT `/hotlines/:id` | 热线配置（不可下线全部热线，内置保护） |
| GET·POST | `/words` · PUT `/words/:id` · POST `/words/sync` | 敏感词分级管理、复核、打包下发端侧 |
| GET  | `/risk` / `/audit` / `/users` | 风控脱敏事件 / 审计日志 / 匿名用户 |

## 铁律（已内置）

1. 所有写操作自动写入审计日志（≥6 个月留存由存储层保证）
2. 热线至少保留 1 条有效配置，接口层强制
3. 用户接口只暴露"匿名 ID + 状态"，无任何内容查看能力
4. 审核接口不保存原文、不回显内容

## 冒烟测试（已通过）

题库新增（待复审+审计留痕）、词库复核、热线替换与"全下线"拦截、看板聚合。

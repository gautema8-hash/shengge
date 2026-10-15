# app/frontend — 「生格」Flutter App

iOS + Android 双端 Flutter 工程（规划中，W1 启动搭建）。

- 技术栈：Flutter 3.47.7 stable ｜ 状态管理 Riverpod ｜ 本地库 drift(SQLite)
- 架构：本地优先（Local-first），云同步为订阅权益
- 设计实现依据：`../ui/生格-设计规范-DesignSystem.md`（ThemeData 映射见其 §9）
- 目录约定：features/ 按功能模块分包，core/ 放 db/sync/risk/config

# 重构验证记录

验证日期：2026-10-04。测试使用独立 PostgreSQL 实例及 `velin_refactor_test` / `velin_ui_test`，没有迁移真实业务数据库，也没有调用真实模型。

## 已执行

- `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check` 全部通过。
- `VELIN_TEST_DATABASE_URL=…/velin_refactor_test pnpm test`：客户端与纯逻辑 25 项通过；数据库及 production 配置集成部分报告 13 项通过、无跳过。
- 迁移 005 在隔离数据库完成回滚和重新应用。
- 浏览器测试账号登录成功；登录/注册共有字段与提交按钮保持同一坐标；邮箱操作验证步与操作步保持卡片尺寸。
- 375px / 320px 宽度下卡片分别采用对应档位，320px 视口无横向溢出；手机操作行纵向排列。
- 弹窗进入及切步聚焦容器；Tab 循环保持在控件内；Escape 关闭后恢复触发按钮焦点。
- Electron 生产构建完成启动；未登录发送直接进入认证页。生产构建通过 `--force-renderer-accessibility` 进行原生界面检查。
- SMTP 不可连接时，直接认证端点及安全包装端点均不报告发送成功；production 隐藏开发回码，限流返回 429 与 Retry-After。
- 客户端伪造地址头无效；可信代理转发链从右侧提取真实客户端地址。

## 构建体积

桌面首屏 JS 约 394 KB（重构前约 1,072 KB）；网页入口约 226 KB（重构前约 537 KB），均为压缩前的 minified 文件大小。Markdown、代码高亮及网页各页面按需加载。部分高亮语法、WASM 和 Markdown 可选 chunk 仍超过 500 KB，构建保留该提醒。

## 环境验收范围

真实 SMTP 成功投递、Google OAuth、真实设备的通行密钥、生产反向代理及真实模型端到端生成仍需对应环境验收。本次检查了 reduced-motion 的 CSS 与切步分支，但没有更改系统动效设置进行实机切换。

应用业务数据库前先执行 `pnpm db:migrate`。代理部署时配置 `TRUSTED_PROXY_ADDRESSES`，并保证代理追加或覆盖 `X-Forwarded-For`；不要直接信任客户端的转发地址。

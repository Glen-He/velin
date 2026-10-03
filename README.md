# Velin

Velin 是一个基于 Electron 的大语言模型桌面客户端，技术栈为 React、Vite、TypeScript、Electron、Better Auth 和 PostgreSQL。

## 架构

```text
Electron renderer
  -> typed preload IPC
  -> Electron main
  -> HTTPS API (本地开发使用 HTTP)
  -> Better Auth / DeepSeek
  -> PostgreSQL (账号与对话调用用量)
```

凭据只在系统浏览器里输入。桌面端只拿到脱敏后的用户资料，会话由 Electron 通过操作系统的安全存储能力加密后持久化。

## 开发

```bash
pnpm install
cp apps/auth-server/.env.example apps/auth-server/.env.local
createdb velin_dev
pnpm db:migrate
pnpm dev
```

`pnpm install` 可能不执行 Electron 的安装脚本（即使 `pnpm-workspace.yaml` 已允许 `electron` 构建），此时 `node_modules/electron/dist` 为空。安装后先用 `pnpm exec electron --version` 确认；缺失时该命令会自行补下载。首次 `pnpm dev` 同样会触发补下载，但在网络不稳时会在启动阶段失败，因此建议先单独跑一次校验。

本地数据库支持的是 PostgreSQL 18 版本线。`pnpm dev` 会把认证 API 起在 3000 端口、浏览器认证页起在 5174 端口、Electron 渲染层起在 5173 端口。配置好 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 之后才可用 Google 登录。邮箱注册默认开放，不要求邀请码。本地环境下邮箱验证码由认证服务打印到终端；生产环境缺少 SMTP 和 HTTPS 配置时同样拒绝启动。

macOS 和 Linux 从命令行启动的开发版不能可靠接收应用协议回跳。开发版点击登录或注册会在浏览器完成验证后显示一次性授权码，桌面端同步进入输入步骤；复制并粘贴该码即可完成登录。已安装且正确注册 `com.velin.desktop` 协议的发布版使用自动回跳。

Google 与邮箱验证码只登录已有账号；注册使用邮箱和密码。内部唯一用户 ID 由认证服务生成并存入 PostgreSQL，注册页不收集姓名，默认显示邮箱。新密码要求 15–128 个字符，允许空格与 Unicode，拒绝控制字符，不强制字符类别组合；服务端还会拒绝已知泄露密码。已有账号的旧密码仍可登录，更改或重置时应用新规则。注册后需通过邮件验证码验证邮箱。

## DeepSeek 对话

在 `apps/auth-server/.env.local` 设置 `DEEPSEEK_API_KEY` 并重启服务，即可使用服务端管理的 DeepSeek V4.1 Flash 流式对话（API 模型 ID 为 `deepseek-flash`）。API Key 只由服务端读取，不要放进 `VITE_*` 环境变量或桌面端。未配置 Key 时，认证功能仍可运行，但发送消息会显示服务未配置。

服务端会验证登录会话和消息长度，按账号限制每分钟 5 次、每天 30 次，并限制服务全局每天 300 次；可分别使用 `CHAT_MINUTE_LIMIT_PER_USER`、`CHAT_DAILY_LIMIT_PER_USER` 和 `CHAT_DAILY_LIMIT_GLOBAL` 调整。所有限额按 UTC 日期计算，调用记录写入 PostgreSQL。当前对话内容只在客户端内存中，关闭应用后不会恢复；持久化和跨设备同步属于后续工作。

## 验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

渲染层是不可信且无特权的 Web 环境。Electron 主进程与 preload 代码位于 `electron/`；原始 Electron API、认证 Cookie 和令牌一律不暴露给渲染层。

## 维护文档

- [模块与职责](docs/architecture.md)
- [设计系统](docs/design-system.md)
- [敏感操作授权](docs/security.md)
- [本次重构验证](docs/refactor-validation.md)

共享协议与视觉基础分别位于 `packages/contracts` 和 `packages/ui`。开发命令会先编译 contracts，再监听变更。新代码首次运行前执行 `pnpm db:migrate`，应用迁移 005 的一次性操作授权表。

认证集成测试需要隔离的 PostgreSQL 数据库，名称必须为 `velin_*test`。先迁移该数据库，再运行全部测试；未配置测试 URL 时，数据库集成部分会明确跳过。

```sh
DATABASE_URL=postgresql://USER@localhost:5432/velin_security_test pnpm db:migrate
VELIN_TEST_DATABASE_URL=postgresql://USER@localhost:5432/velin_security_test pnpm test
```

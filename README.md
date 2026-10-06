# Velin

Velin 是连接大语言模型的 Electron 桌面生产力客户端。仓库使用 pnpm workspace，网页登录、认证、HTTP API 和 PostgreSQL 访问由一个 Next.js 全栈应用提供；桌面端使用 React、Vite 与 TypeScript，认证使用 Better Auth。

## 项目结构

```text
velin/
├── apps/
│   ├── desktop/                  # Electron 桌面应用
│   │   ├── src/
│   │   │   ├── main/             # 窗口、IPC、安全凭据与远端调用
│   │   │   ├── preload/          # 窄类型桥接
│   │   │   └── renderer/         # 桌面对话、设置与账号界面
│   │   ├── tests/
│   │   └── package.json
│   └── web/                      # Next.js 全栈应用
│       ├── src/
│       │   ├── app/              # 页面、layout 与 API 入口
│       │   ├── components/       # 网页 UI 与交互
│       │   ├── lib/              # 业务、认证、PostgreSQL 与服务边界
│       │   └── styles/
│       ├── migrations/           # PostgreSQL schema 版本变更 SQL
│       ├── scripts/              # Next.js 的 Node 启动入口
│       ├── tests/
│       └── package.json
├── packages/
│   ├── contracts/                # 跨端协议、schema 与纯策略
│   └── ui/                       # 共用视觉令牌与界面原语
├── docs/                         # 架构、设计与维护文档
├── AGENTS.md                     # 工程规则
├── package.json                  # 仓库级命令
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

根目录保留 workspace 配置、统一命令、锁文件、README 和工程规则。应用配置和测试由各应用维护，共享包的测试放在对应包内；不建立空目录或没有实际复用的包。

```text
Electron renderer → typed preload → Main → Next.js HTTP API
                                                ↓
Next.js Server Component → 服务端业务 → PostgreSQL / 外部服务
```

凭据只在系统浏览器输入。桌面会话由 Main 使用操作系统安全存储持久化，Renderer 只接收可展示资料。桌面窗口、本地偏好和对话状态继续在 Electron 内运行。页面默认使用 Server Component，数据库、密钥与认证实现禁止进入客户端组件。

## 本地开发

使用 Node.js 24 与 pnpm，数据库支持 PostgreSQL 18 版本线。

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
createdb velin_dev
pnpm db:migrate
pnpm dev
```

启动前在 `apps/web/.env.local` 设置本机 `DATABASE_URL` 与随机 `BETTER_AUTH_SECRET`。`pnpm dev` 先编译共享协议，然后启动 Next.js（3000）和 Electron 的 Vite 渲染服务（5173），同时监听共享协议变更。网页登录与 HTTP API 现在使用同一来源，不再另启 5174 服务。`APP_URL` 是浏览器可访问的统一 Web 地址；桌面 Main 使用 `VELIN_API_SERVER_URL` 选择同一服务，默认 `http://localhost:3000`。

`DATABASE_URL` 必须显式配置为 PostgreSQL 连接地址；缺失、空值或协议不正确会阻止 Web 服务启动，不默认连接开发者的本机数据库。

只启动网页可用 `pnpm dev:web`，只启动客户端可用 `pnpm dev:desktop`，后者需要已有可用 Web 服务。Electron 缺少下载的运行时文件时，在桌面应用目录运行 `pnpm exec electron --version` 检查并完成安装；只允许已评估依赖执行构建脚本。

Google 登录需要配齐 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`，回调地址使用 `APP_URL` 下的 `/api/auth/callback/google`。邮箱注册保留可选邀请码输入框，当前暂未启用，不影响注册。开发 console 邮件通过显式开发回码提供验证码，终端只记录结构化事件；生产禁止 console 传输和开发回码。

macOS 和 Linux 从命令行启动的开发版不能可靠接收应用协议回跳。开发登录在系统浏览器完成后显示一次性授权码，复制并粘贴回客户端即可登录。已安装且注册 `com.velin.desktop` 协议的发布版自动回跳。

Google 与邮箱验证码只登录已有账号；注册使用邮箱和密码，默认显示邮箱，注册后需验证邮箱。新密码要求 8–32 位英文字母、数字或英文符号，不允许中文、空格及其他空白字符，不强制字符类别组合。已有账号的旧密码可登录，更改或重置时执行新规则。

## 对话

在 `apps/web/.env.local` 设置 `DEEPSEEK_API_KEY` 并重启 Web 服务，即可使用服务端管理的 DeepSeek Flash 流式对话，模型 ID 为 `deepseek-flash`。Key 不进入 `NEXT_PUBLIC_*`、`VITE_*` 或桌面代码。未配置 Key 时，本地认证仍可运行，发送消息显示服务未配置。

服务端校验会话、消息和预算，默认每账号每分钟 5 次、每日 30 次，全局每日 300 次。对应配置为 `CHAT_MINUTE_LIMIT_PER_USER`、`CHAT_DAILY_LIMIT_PER_USER` 与 `CHAT_DAILY_LIMIT_GLOBAL`，按 UTC 日期计算，调用记录保存到 PostgreSQL。对话内容目前只在客户端内存，关闭后不恢复；本次架构迁移不引入持久化或跨设备同步。

字体由两端共享令牌统一：Apple 使用原生 UI 字体与苹方，其他平台英文与数字使用 Inter，中文使用思源黑体，均为随应用自托管的 WOFF2 子集，字体按字符范围加载，无运行时 CDN。授权和维护方法见 [字体资源说明](packages/ui/fonts/README.md)。

回复使用 Streamdown 渲染流式 Markdown，支持中文标点附近的加粗、GFM 列表与表格、代码高亮、KaTeX 公式和按需加载的 Mermaid 图表。正文、标题与代码采用独立阅读档位；宽代码、表格和公式局部横向滚动。图表加载或解析失败保留源内容，远程图片默认仅显示文字引用。视觉标尺与使用约束见 [设计系统](docs/design-system.md) 和 [界面约束](docs/interface-guidelines.md)。

## 构建与运行

```bash
pnpm build
pnpm start
```

`pnpm build` 构建共享协议、Next.js 和桌面资源；`pnpm start` 运行构建后的 Web Node 服务。Web 部署须配置生产数据库、HTTPS `APP_URL`、SMTP、Google OAuth 与模型凭据，在受控反向代理处终止 HTTPS。只有明确的代理 IP 可以设置 `TRUSTED_PROXY_ADDRESSES`。

Web 必须使用项目启动入口，以真实 socket 覆盖伪造的地址头，保护限流；不要绕过它直接运行 `next start/dev`。此部署方式不使用 standalone 输出或 serverless 函数，部署取舍见 [模块与职责](docs/architecture.md)。桌面构建产物位于 `apps/desktop/dist` 与 `dist-electron`，当前构建不生成安装包。

桌面 HTML 默认使用严格 CSP；Vite 开发服务只放行实际 HMR WebSocket 来源，并为 React 前导脚本添加 nonce。所有构建产物均不信任开发服务器，即使使用 `--mode development` 构建也不放宽策略。

## 数据库与验证

数据库继续使用 PostgreSQL、pg 与版本化 SQL；已执行的 schema 变更文件保留为数据库版本记录，后续结构变化新增迁移文件，不改写已执行 SQL。它记录数据库结构如何演进，不代表保留旧版应用的兼容代码。运行新代码前先执行 `pnpm db:migrate`。`pnpm db:rollback` 回退最后一次迁移，数据恢复仍须依靠备份；`pnpm db:generate` 生成认证 schema 的 SQL 草案，需要审查并整理成版本化迁移后应用。

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

认证集成测试使用独立 PostgreSQL 数据库，名称必须为 `velin_*test`，避免影响开发账号。未设置测试 URL 时数据库集成测试明确跳过；认证或架构修改须额外运行它。

```bash
DATABASE_URL=postgresql://USER@localhost:5432/velin_security_test pnpm db:migrate
VELIN_TEST_DATABASE_URL=postgresql://USER@localhost:5432/velin_security_test pnpm test
VELIN_TEST_DATABASE_URL=postgresql://USER@localhost:5432/velin_security_test pnpm --filter @velin/web test:pages
```

真实邮件投递、Google OAuth、设备通行密钥和生产代理需要对应环境验收，不能以本地测试替代。

## 维护文档

- [模块与职责](docs/architecture.md)
- [设计系统](docs/design-system.md)
- [界面与交互约束](docs/interface-guidelines.md)
- [工程与设计维护规范](docs/engineering-guidelines.md)
- [认证与敏感操作](docs/security.md)

共享包采用 workspace 依赖，不通过相对路径访问另一应用源码。视觉尺寸以设计令牌与组件样式为事实来源，文档记录职责、依据与稳定约束。

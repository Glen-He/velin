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

启动前在 `apps/web/.env.local` 设置本机 `DATABASE_URL` 与随机 `BETTER_AUTH_SECRET`。`pnpm dev` 先编译共享协议，然后启动 Next.js（3000）、独立 OCR worker（pg-boss）、Electron 的 Vite 渲染服务（5173），同时监听共享协议变更。网页登录与 HTTP API 现在使用同一来源，不再另启 5174 服务。`APP_URL` 是浏览器可访问的统一 Web 地址；桌面 Main 使用 `VELIN_API_SERVER_URL` 选择同一服务，默认 `http://localhost:3000`。PDF 识别、个人记忆提取与后台历史整理共用独立 worker 进程内的不同队列；只启动 Web 时后台任务会停在队列中，发送时仍会按需整理缺失的历史摘要。

`DATABASE_URL` 必须显式配置为 PostgreSQL 连接地址；缺失、空值或协议不正确会阻止 Web 服务启动，不默认连接开发者的本机数据库。

只启动网页与 OCR worker 可用 `pnpm dev:web`，只启动客户端可用 `pnpm dev:desktop`，后者需要已有可用 Web 服务。Electron 缺少下载的运行时文件时，在桌面应用目录运行 `pnpm exec electron --version` 检查并完成安装；只允许已评估依赖执行构建脚本。

Google 登录需要配齐 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`，回调地址使用 `APP_URL` 下的 `/api/auth/callback/google`。邮箱注册保留可选邀请码输入框，当前暂未启用，不影响注册。开发 console 邮件通过显式开发回码提供验证码，终端只记录结构化事件；生产禁止 console 传输和开发回码。

macOS 和 Linux 从命令行启动的开发版不能可靠接收应用协议回跳。开发登录在系统浏览器完成后显示一次性授权码，复制并粘贴回客户端即可登录。已安装且注册 `com.velin.desktop` 协议的发布版自动回跳。

Google 与邮箱验证码只登录已有账号；注册使用邮箱和密码，默认显示邮箱，注册后需验证邮箱。新密码要求 8–32 位英文字母、数字或英文符号，不允许中文、空格及其他空白字符，不强制字符类别组合。已有账号的旧密码可登录，更改或重置时执行新规则。

## 对话

在 `apps/web/.env.local` 设置 `DEEPSEEK_API_KEY` 并重启 Web 服务，即可使用服务端管理的 DeepSeek Flash 流式对话，模型 ID 为 `deepseek-flash`。Key 不进入 `NEXT_PUBLIC_*`、`VITE_*` 或桌面代码。未配置 Key 时，本地认证仍可运行，发送消息显示服务未配置。

服务端校验会话、消息和预算，默认每账号每分钟 5 次、每日 30 次，全局每日 300 次。对应配置为 `CHAT_MINUTE_LIMIT_PER_USER`、`CHAT_DAILY_LIMIT_PER_USER` 与 `CHAT_DAILY_LIMIT_GLOBAL`，按 UTC 日期计算，调用记录保存到 PostgreSQL。会话与消息也保存在 PostgreSQL：服务端按用户校验归属，流式开始时写入用户消息和回复占位，生成期间定期保存，停止、失败或断线时保存最终状态与 token 用量。模型调用统一使用 DeepSeek Responses API。服务端组合完整近期轮次、滚动历史摘要、相关原文、个人记忆及文件证据，不接受客户端回传历史。DeepSeek 不持久化会话，记忆由 Velin 管理，详见 [对话与记忆](docs/conversation-memory.md)。首轮对话会并行调用模型生成简短标题，失败时保留首条消息标题；标题来源记录在 `title_source`，后续自动生成不会覆盖已确认的标题。桌面端登录后恢复会话列表，选择会话时按序加载消息，超过 50 条可分页读取更早内容；侧栏支持按标题搜索、手动重命名和拖拽排序，排序写入 `sort_order`，新建对话默认置顶；删除对话需要确认并级联删除消息。生成中的回复不提供复制，完成后可复制或重新生成，中断或失败后可重试；重试使用同一条用户消息，原对话路径保存为独立历史版本，可恢复；不会重置已生成的标题。输入框右侧可选择 DeepSeek-Flash 或 DeepSeek-V4-Pro，并通过滑块设置推理强度（关闭/低/高/最大）；思考内容随回复流式保存，历史中可按需展开，复制只复制正文。

字体由两端共享令牌统一：Apple 使用原生 UI 字体与苹方，其他平台英文与数字使用 Inter，中文使用思源黑体，均为随应用自托管的 WOFF2 子集，字体按字符范围加载，无运行时 CDN。授权和维护方法见 [字体资源说明](packages/ui/fonts/README.md)。

回复使用 Streamdown 渲染流式 Markdown，支持中文标点附近的加粗、GFM 列表与表格、代码高亮、KaTeX 公式和按需加载的 Mermaid 图表。正文、标题与代码采用独立阅读档位；宽代码、表格和公式局部横向滚动。图表加载或解析失败保留源内容，远程图片默认仅显示文字引用。视觉标尺与使用约束见 [设计系统](docs/design-system.md) 和 [界面约束](docs/interface-guidelines.md)。

## 构建与运行

```bash
pnpm build
pnpm start
```

`pnpm build` 构建共享协议、Next.js 和桌面资源；`pnpm start` 运行构建后的 Web Node 服务。Web 部署须配置生产数据库、HTTPS `APP_URL`、SMTP、Google OAuth 与模型凭据，在受控反向代理处终止 HTTPS。只有明确的代理 IP 可以设置 `TRUSTED_PROXY_ADDRESSES`。

Web 必须使用项目启动入口，以真实 socket 覆盖伪造的地址头，保护限流；不要绕过它直接运行 `next start/dev`。此部署方式不使用 standalone 输出或 serverless 函数，部署取舍见 [模块与职责](docs/architecture.md)。桌面构建产物位于 `apps/desktop/dist` 与 `dist-electron`，安装包与未签名测试目录分别通过 `package:release`、`package:dir` 生成；正式包随 Main 固定 HTTPS 服务来源，并要求签名、公证及更新源配置，见 [部署与恢复](docs/operations.md)。

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
VELIN_TEST_DATABASE_URL=postgresql://USER@localhost:5432/velin_security_test pnpm --filter @velin/web test:ocr-load
```

`test:ocr-load` 会生成 300 页扫描 PDF，并用独立 OCR worker 跑完真实识别、缓存和进度链路；耗时较长，不包含在常规测试中。压测输出耗时、吞吐与 OCR 主 worker 的 RSS；解析子进程的 RSS 需要另外采样，不能把主 worker 采样视为总内存预算。

真实邮件投递、Google OAuth、设备通行密钥和生产代理需要对应环境验收，不能以本地测试替代。

## 维护文档

- [模块与职责](docs/architecture.md)
- [设计系统](docs/design-system.md)
- [界面与交互约束](docs/interface-guidelines.md)
- [工程与设计维护规范](docs/engineering-guidelines.md)
- [认证与敏感操作](docs/security.md)
- [部署、发布、保留与恢复](docs/operations.md)

共享包采用 workspace 依赖，不通过相对路径访问另一应用源码。视觉尺寸以设计令牌与组件样式为事实来源，文档记录职责、依据与稳定约束。

CI 使用 `pnpm test:ci` 强制隔离数据库、迁移、全部集成测试、300 页 OCR 和真实页面检查；缺少数据库时直接失败。日额度使用原子计数桶，标题、主回复和上下文整理分别记录已知 token 用量。生产就绪检查为 `/api/ready`。新增 SQL 迁移必须在启动新代码前应用。

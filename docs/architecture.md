# 模块与职责

Velin 使用 pnpm workspace，包含两个应用：Electron 桌面客户端与一个 Next.js 全栈应用。网页登录和 HTTP 服务属于同一个 Web 应用，不另拆 frontend/backend；根目录只承担 workspace 命令、依赖锁定和仓库级规则。

```text
apps/desktop/src/renderer → typed preload → Main → Next.js HTTP API
                                                     ↓
Next.js Server Component → apps/web/src/lib → PostgreSQL / 外部服务
```

| 位置                             | 职责                                        | 允许依赖                                |
| -------------------------------- | ------------------------------------------- | --------------------------------------- |
| `apps/web/src/app`               | URL、页面/layout、loading/error 与 API 入口 | components、lib、Next.js                |
| `apps/web/src/components`        | 网页展示、表单、账号与安全交互              | UI、浏览器 auth client、HTTP、contracts |
| `apps/web/src/lib`               | 认证、业务策略、SQL、模型代理与 HTTP 边界   | 服务端库、contracts；浏览器适配独立模块 |
| `apps/web/scripts/web-server.ts` | Next.js 启动、连接地址验证、关闭            | Node、Next.js、配置与日志               |
| `apps/web/migrations`            | PostgreSQL 版本化迁移                       | 现有 SQL 迁移工具                       |
| `apps/desktop/src/main`          | 窗口、IPC、安全凭据与远端调用               | Electron、认证库、contracts             |
| `apps/desktop/src/preload`       | 窄类型桥接                                  | Electron、contracts                     |
| `apps/desktop/src/renderer`      | 对话、设置、账号展示与本地偏好              | DOM、UI、contracts、typed preload       |
| `packages/contracts`             | 跨端协议、边界 schema 与纯策略              | Zod、纯解析工具；无特权 runtime         |
| `packages/ui`                    | 视觉令牌、主题、模态、字段与图像原语        | React、DOM、Lucide；无特权 API          |

## Web 的入口与业务

`page.tsx` 和 `layout.tsx` 默认是 Server Component，负责页面组合与服务端数据入口。账号布局在服务端检查会话，账号页面直接读取业务能力，只将可展示的用户字段交给交互组件，不把 session token 序列化给浏览器组件。登录、设备和安全操作需要真实交互，因此保留明确的 Client Component 边界。数据库和认证实现标记 `server-only`，不能进入客户端导入链。

Route Handler 使用原生 Request/Response，调用 `lib` 中的业务函数；输入预算、来源、会话、权限与限流仍由服务端执行。聊天使用原生 Web Stream 发送共享事件协议，保留背压，连接关闭和超时取消上游请求。Server Component 不经自己的 HTTP API 绕路读取数据库；不为没有使用的 Server Actions 建空目录。

`lib` 按真实职责组织 auth、database、security、chat 与 HTTP 边界。小模块保持简单，不把所有工具塞入 utils，也不为目录对称创造无用途的 shared 包。Client auth 与服务端 auth 分文件；客户端只能导入浏览器安全的适配。

## 启动与部署

一个很薄的 Node 入口启动 Next.js，所有页面和 API 路由仍由 Next.js 管理。它覆盖外部传入的客户端地址头，根据真实 socket 与显式可信代理生成限流地址，并处理服务器关闭。必须使用 `pnpm dev:web` 或 `pnpm start`，直接使用 `next dev/start` 会绕过这个地址边界。

生产部署使用 Node 服务并在受控反向代理处终止 HTTPS，配置 `APP_URL` 和可信代理地址。此启动方式不使用 Next.js standalone 输出，也不直接部署为 Vercel/serverless 函数；更换部署方式前必须重新实现并验证连接地址信任边界。[Next.js 自定义服务说明](https://nextjs.org/docs/app/guides/custom-server)描述了该部署取舍。

登录页保持浅色认证主题，账号与安全页面跟随系统主题；两个路由组分别提供根布局，跨组导航由框架执行完整页面加载，避免主题切换闪烁。CSS 级联顺序和共享令牌保留，迁移不顺手改造产品设计。

网页外部状态订阅提供独立、稳定且两端一致的初始快照，副作用在 hydration 后执行。React 渲染回归与真实 Next.js 已登录页面验收分别覆盖 Hook 和完整入口，避免只验证 API 或未登录跳转。

测试归所属应用或共享包，Web 的集成测试加载真实 Route Handler、Better Auth 与 PostgreSQL；传输大小测试另用实际 Node HTTP 连接。数据库测试必须显式指定隔离测试库。构建检查 Next.js 服务端/客户端边界，运行验收另覆盖实际 Next.js HTTP 服务与 Electron。

聊天状态只有 `chat-store.ts` 一份。发送、编辑重发、请求登记与流式事件同步更新；React 用 `useSyncExternalStore` 读取快照。取消先让请求失效再发 IPC，迟到事件不再修改状态。账号改变时停止所有请求并清除该账号的数据。

PostgreSQL 是聊天历史的持久化来源：`chat_conversation` 按用户归属，`chat_message` 以递增 sequence 排序；流式请求在调用模型前写入用户消息与 assistant 占位，生成期间定期 checkpoint，结束、停止或断线时落最终状态和 token 用量。模型上下文由服务端从持久化消息中选取，不信任 renderer 回传的历史。首轮同时启动标题生成，使用第一条用户消息生成短标题，完成后通过 `message-complete` 的 `title` 字段回传并更新侧栏；标题来源由 `title_source` 记录，手动重命名会标记为 `manual`，生成失败或超时保留首条消息标题。登录后 hydrate 会话摘要，选择会话时按游标分页加载消息；加载期间保持空白并用 `aria-busy` 表达状态，不显示“正在加载”文字；加载失败与空会话分别表示。侧栏通过有界游标分页读取摘要，标题搜索由服务端覆盖所有对话；拖拽提交源、目标与相对位置，通过 `sort_order` 持久化，不再传输完整 ID 数组，写入失败会回滚本地顺序并提供重试。重试与重新生成复用同一条用户消息 ID：服务端将完整原路径保存为不可变版本，停用该消息之后的旧回复并生成新回复；内容未变化时不重置标题来源。用户消息可携带文本/代码/PDF/DOCX/XLSX/PPTX/OpenDocument/RTF/EPUB/TeX 或图片附件：Main 通过系统文件选择器读取并上传，图片由服务端受限子进程完整解码并生成缩略图，renderer 只持有附件描述；服务端校验类型和大小，文本文件按 UTF-8 解码，PDF 使用 officeparser/pdf.js 提取文本并限制 300 页，逐页判断文本层：有文本的页直接提取，扫描页再用本地 Tesseract OCR（中英文，单次最多 300 页）；OCR 前对低分辨率页做灰度、放大和锐化，按词框保留分栏与缩进，移除重复页眉页脚，输出 OCR 页范围、低置信度页码与失败页码，超出上限或超时的页面明确标注而不静默丢弃；PDF 上传只校验并持久化源文件，附件先进入 `processing` 并写入 PostgreSQL 队列（pg-boss），由独立 worker 进程按页处理；原始逐页结果和置信度写入 `chat_attachment_page`，进度写入附件记录，按用户、文件哈希和引擎版本缓存 OCR 页；去页眉仅影响最终组装，不污染原始页缓存。每次重新识别创建独立 generation，worker 每次执行再领取 attempt，写入时在同一事务内锁定并验证附件状态与执行身份；取消立即关闭写入权限，旧任务不能覆盖新任务结果。系统异常由 pg-boss 自动重试，耗尽重试后由失败队列收敛附件状态；worker 重启从已提交页继续；待发送 PDF 可在 chip 上指定 OCR 页码（最多 300 页），状态接口向桌面端返回页数/进度，只有 `ready` 附件可发送和进入提示词；DOCX 使用 `officeparser`，XLSX 使用 `exceljs` 按工作表转成受限 TSV（最多 20 个工作表、每表 1000 行、50 列），PPTX/OpenDocument/RTF/EPUB/TeX 复用 officeparser，所有文档统一限制 10 万字符；加密、无文本和格式无效文件会明确报错。图片支持 PNG/JPEG/WebP，单张最多 5 MB、每条消息最多 4 张，仅对 `supportsImages` 的模型开放；服务端存储原图与缩略图，提示词按消息预算把图片作为 content parts 发给模型。创建用户消息时把附件原子绑定到该消息。历史加载返回附件元数据与缩略图；尚未发送的附件按新会话或所属会话记录草稿作用域，桌面端重开应用或切换回来时从服务端恢复附件与识别进度，输入文字按账号和会话保存在本地，保留 24 小时且数量有界，发送后清除；绑定消息时校验草稿作用域，删除会话会级联清理其待发送附件。独立维护任务回收超过 24 小时的暂存附件，并清理过期或无附件引用的 OCR 缓存。逐页缓存按全局 20000 行、单用户 6000 行上限在文档处理结束后淘汰最旧页；300 页真实扫描件通过 `pnpm --filter @velin/web test:ocr-load` 按需压测，常规测试不承担该耗时。模型与思考强度是客户端偏好，随每次请求进入 contracts 校验。模型目录是模型身份与能力的唯一来源：普通四档模型只需声明 id 与名称，默认获得标准四档；三档或零档模型显式覆盖 `supportedReasoningEfforts`，视觉模型声明 `supportsImages`。服务端按所选模型校验强度，并更新会话最近使用的模型。客户端按模型分别持久化上次选择的档位，切回某个模型时恢复该模型的记忆；首次选择新模型时沿用当前档位并收敛到最近的支持项。没有推理档位的模型不渲染推理控件，请求按关闭处理，服务端也不会向上游发送推理强度。思考内容通过独立 SSE 事件流式回传，和正文一起 checkpoint 到 `chat_message.reasoning`，历史加载时可展开查看。删除对话经确认后级联删除消息，账号切换仍清理本地会话状态。

认证和安全页面将请求逻辑分别放在 `useSignInFlow` 与 `useSecurityFlow`，视图负责布局。步骤历史和发送槽的纯状态转换单独测试；请求有取消、错误码及恢复路径。字段值允许局部状态，多个 state 不等同于错误设计；跨字段的阶段与授权转换必须集中处理。

网页登录入口由 `auth-action` 统一提交占用、取消、响应错误与迟到结果处理，密码、验证码、OAuth 与授权交接共用同一生命周期。页面只描述各条认证路径，不能分别复制提交锁和错误处理；更换收件邮箱后清除旧验证码阶段，重新发送。

网页账号的会话列表由 `session-list-store` 管理账号作用域、读取序号、取消与写入占用；`useSessions` 负责订阅和生命周期，`SessionsPage` 负责显示。无会话、空列表、读取失败与写入后刷新失败分别表示；离开页面或切换账号后，旧结果不能改变新列表。网页认证库需要的 token 留在网页边界，桌面 DTO 只提供会话 ID。

桌面设备列表也由独立 store 管理生命周期、读取顺序与写入占用。IPC 没有取消句柄，关闭后丢弃迟到响应；单设备与批量退出不能重叠，写入成功后先反映已知结果，刷新失败保留重试入口。退出登录确认由根层统一呈现，失败留在当前弹窗，不写入隐藏的登录页错误槽。

Main 的 `auth-state-sync` 为后台认证读取排序，显式登录、退出与会话过期事件使旧读取失效。网络失败保留已知状态，明确的未登录结果仍正常发布；Renderer 初次读取同样不能覆盖已经收到的状态事件。

桌面端的网页登录、安全页面、头像与对话都引用 Main 中唯一的 `serviceUrl`，指向同一个 Next.js 来源；不保留网页与 HTTP 服务分离时期的地址别名。

授权交接的成功结果通过认证库的公开生命周期 Hook 进入 Main 的统一状态通道，不直接订阅库的另一路 Renderer 登录通知。Main 显式启用打包版本的深链注册，开发环境使用手动授权码；关闭库的通用桥接和默认头像代理，CSP 与头像读取由项目自己的边界负责。

共用本地化错误文案由 contracts 的 `error-copy` 提供，运行时诊断通过各端边界转成用户反馈。服务端只在 `logging.ts` 接触 console，业务代码记录稳定事件和白名单字段；不把第三方任意参数展开到日志。

自有头像只保存 `/api/avatars/:userId?v=...` 相对引用；迁移 `006` 依据图片记录规范化已有数据，不保留旧绝对地址解析。图片和用户引用原子写入，读取按内容 ETag 验证缓存。桌面 Main 限制来源、跳转、类型与实际字节数；Renderer 按账号与引用共享临时对象 URL，最后一个使用者退出后释放。头像视图由 UI 的 `AvatarDialog` 共用，裁剪与上传生命周期由 `useAvatarCrop` 管理，关闭后的结果不再操作界面。

网页通行密钥列表与账号作用域绑定，取消读取并丢弃旧响应，读取失败保留明确错误。Main 聊天传输由 `stream-runtime` 管理，终止事件立即释放会话占用；服务端事件经共享 schema 与请求、消息标识校验，取消后的响应不再改变登录状态。

名称编辑视图共用 UI 的 `DisplayNameDialog`，校验、Unicode 计数与保存生命周期由 `useDisplayNameEdit` 管理。退出登录与设备退出共用 `ConfirmationDialog`；HTTP 与 IPC 调用仍归所属端，设备列表 store 返回真实写入结果，确认卡片据此保留失败或关闭。关闭后旧响应不再关闭新窗口；桌面账号视图按用户 ID 重新挂载，旧账号的编辑和设备列表不能延续到新账号。设置列自身提供容器宽度，内容内缩和富控件降档均由 CSS 表达，不引入 resize 测量状态。

共享包使用 workspace 依赖，应用不能通过相对路径越界读取另一应用的源目录。contracts 在运行/构建前编译，统一开发命令同时监听 contracts 变更。UI 源码交给应用构建器处理，避免引入第二套 bundler 配置。

`pnpm format` / `format:check` 固定代码风格；`pnpm lint`、`typecheck`、`test` 与 `build` 负责静态与行为检查。数据库通过版本化 SQL 迁移；已执行迁移不改写历史，新增迁移清理废弃字段。数据规范化与字段删除前先备份；`006` 不恢复旧部署地址，`007` 回滚仅恢复字段定义，历史数据恢复使用备份。

## 可靠性与处理预算

回复终态和主请求用量原子提交后才发送完成事件；标题单独记录用量，缺失值表示未知。慢数据库 checkpoint 合并到最新快照。`incomplete` 与失败、取消和完整成功分别表示；恢复中的远端回复有有界重查。历史和附件请求绑定 Main 的凭据代次，账号 A → 退出 → A 也不能接受旧响应。

对话预留先串行化当前账号，再原子更新有上限的全局日桶，不能在等待账号时持有全局锁。过期清理同时关闭流式消息与用量租约；checkpoint 与最终保存受活动状态、终态和生成身份约束。独立摘要与历史召回并行、失败时取消并等待，结束后仍复核上下文来源与修订。阶段和首段输出耗时只记录标识与数值，不记录正文。

文档授权、容量和解析槽位预留先提交短事务，再进入可终止的解析进程。Office ZIP 验证实际解压预算；图片验证完整解码、像素和尺寸；PDF 的目录分析与页面图像提取也有独立进程、堆与超时限制。子进程不继承服务凭据。系统总资源限制仍归部署平台。具体配置和运维边界见 [部署与恢复](operations.md)。

模型接口、上下文预算、记忆隔离及后台整理的约定见 [对话与记忆](conversation-memory.md)。

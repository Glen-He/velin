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

聊天状态只有 `chat-store.ts` 一份。发送、编辑重发、请求登记与流式事件同步更新；React 用 `useSyncExternalStore` 读取快照。取消先让请求失效再发 IPC，迟到事件不再修改状态。账号改变时停止所有请求并清除该账号的数据。聊天当前仍保存在内存中，重构没有偷偷引入持久化格式或新的数据迁移。

认证和安全页面将请求逻辑分别放在 `useSignInFlow` 与 `useSecurityFlow`，视图负责布局。步骤历史和发送槽的纯状态转换单独测试；请求有取消、错误码及恢复路径。字段值允许局部状态，多个 state 不等同于错误设计；跨字段的阶段与授权转换必须集中处理。

网页登录入口由 `auth-action` 统一提交占用、取消、响应错误与迟到结果处理，密码、验证码、OAuth 与授权交接共用同一生命周期。页面只描述各条认证路径，不能分别复制提交锁和错误处理；更换收件邮箱后清除旧验证码阶段，重新发送。

网页账号的会话列表由 `session-list-store` 管理账号作用域、读取序号、取消与写入占用；`useSessions` 负责订阅和生命周期，`SessionsPage` 负责显示。无会话、空列表、读取失败与写入后刷新失败分别表示；离开页面或切换账号后，旧结果不能改变新列表。网页认证库需要的 token 留在网页边界，桌面 DTO 只提供会话 ID。

桌面设备列表也由独立 store 管理生命周期、读取顺序与写入占用。IPC 没有取消句柄，关闭后丢弃迟到响应；单设备与批量退出不能重叠，写入成功后先反映已知结果，刷新失败保留重试入口。退出登录确认由根层统一呈现，失败留在当前弹窗，不写入隐藏的登录页错误槽。

Main 的 `auth-state-sync` 为后台认证读取排序，显式登录、退出与会话过期事件使旧读取失效。网络失败保留已知状态，明确的未登录结果仍正常发布；Renderer 初次读取同样不能覆盖已经收到的状态事件。

授权交接的成功结果通过认证库的公开生命周期 Hook 进入 Main 的统一状态通道，不直接订阅库的另一路 Renderer 登录通知。Main 显式启用打包版本的深链注册，开发环境使用手动授权码；关闭库的通用桥接和默认头像代理，CSP 与头像读取由项目自己的边界负责。

共用本地化错误文案由 contracts 的 `error-copy` 提供，运行时诊断通过各端边界转成用户反馈。服务端只在 `logging.ts` 接触 console，业务代码记录稳定事件和白名单字段；不把第三方任意参数展开到日志。

自有头像只保存 `/api/avatars/:userId?v=...` 相对引用；迁移 `006` 依据图片记录规范化已有数据，不保留旧绝对地址解析。图片和用户引用原子写入，读取按内容 ETag 验证缓存。桌面 Main 限制来源、跳转、类型与实际字节数；Renderer 按账号与引用共享临时对象 URL，最后一个使用者退出后释放。头像视图由 UI 的 `AvatarDialog` 共用，裁剪与上传生命周期由 `useAvatarCrop` 管理，关闭后的结果不再操作界面。

网页通行密钥列表与账号作用域绑定，取消读取并丢弃旧响应，读取失败保留明确错误。Main 聊天传输由 `stream-runtime` 管理，终止事件立即释放会话占用；服务端事件经共享 schema 与请求、消息标识校验，取消后的响应不再改变登录状态。

名称编辑视图共用 UI 的 `DisplayNameDialog`，校验、Unicode 计数与保存生命周期由 `useDisplayNameEdit` 管理。退出登录与设备退出共用 `ConfirmationDialog`；HTTP 与 IPC 调用仍归所属端，设备列表 store 返回真实写入结果，确认卡片据此保留失败或关闭。关闭后旧响应不再关闭新窗口；桌面账号视图按用户 ID 重新挂载，旧账号的编辑和设备列表不能延续到新账号。设置列自身提供容器宽度，内容内缩和富控件降档均由 CSS 表达，不引入 resize 测量状态。

共享包使用 workspace 依赖，应用不能通过相对路径越界读取另一应用的源目录。contracts 在运行/构建前编译，统一开发命令同时监听 contracts 变更。UI 源码交给应用构建器处理，避免引入第二套 bundler 配置。

`pnpm format` / `format:check` 固定代码风格；`pnpm lint`、`typecheck`、`test` 与 `build` 负责静态与行为检查。数据库通过版本化 SQL 迁移；已执行迁移不改写历史，新增迁移清理废弃字段。数据规范化与字段删除前先备份；`006` 不恢复旧部署地址，`007` 回滚仅恢复字段定义，历史数据恢复使用备份。

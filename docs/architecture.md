# 模块与职责

| 位置                                | 职责                                             | 允许依赖                                    |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `packages/contracts`                | 跨端协议、边界 schema、纯策略与设备显示规则      | Zod、纯解析工具；无 Electron、React、数据库 |
| `packages/ui`                       | 视觉令牌、主题、原生模态、字段与图像原语         | React、DOM、Lucide；无特权 API              |
| `src/features/chat`                 | 对话状态、流式事件、输入与长文展示               | contracts、UI、typed preload                |
| `src/features/shell`                | 侧栏几何、窗口状态与手势生命周期                 | DOM、窗口 preload                           |
| `src/features/preferences`          | 偏好类型、设置持久化与根主题同步                 | localStorage；不依赖设置页面                |
| `src/features/settings` / `account` | 页面组装、设置分类与账号操作                     | UI、typed preload                           |
| `electron/auth` / `chat`            | 安全凭据与远端调用、流式适配                     | Electron、认证库、contracts                 |
| `apps/auth-web/src/auth`            | 系统浏览器登录、凭据请求、桌面授权交接           | auth client、HTTP、UI                       |
| `apps/auth-web/src/security`        | 一次性授权、步骤历史、收件人发送槽与敏感操作呈现 | auth client、HTTP、contracts                |
| `apps/auth-server/src`              | HTTP 组装、认证、授权、模型代理、数据库          | 服务端库、contracts                         |

入口以组装为主。网页 `App` 按路由懒加载页面；服务端 `app.ts` 可被 HTTP 测试加载，`server.ts` 只负责监听和关闭。设置按账号、外观、偏好分类；不按文件行数强行把同一流程拆成无意义的小文件。

聊天状态只有 `chat-store.ts` 一份。发送、编辑重发、请求登记与流式事件同步更新；React 用 `useSyncExternalStore` 读取快照。取消先让请求失效再发 IPC，迟到事件不再修改状态。账号改变时停止所有请求并清除该账号的数据。聊天当前仍保存在内存中，重构没有偷偷引入持久化格式或新的数据迁移。

认证和安全页面将请求逻辑分别放在 `useSignInFlow` 与 `useSecurityFlow`，视图负责布局。步骤历史和发送槽的纯状态转换单独测试；请求有取消、错误码及恢复路径。字段值允许局部状态，多个 state 不等同于错误设计；跨字段的阶段与授权转换必须集中处理。

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

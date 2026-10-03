# 模块与职责

| 位置                                | 职责                                             | 允许依赖                                    |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| `packages/contracts`                | 跨端协议、边界 schema、纯策略与设备显示规则      | Zod、纯解析工具；无 Electron、React、数据库 |
| `packages/ui`                       | 视觉令牌、主题、原生模态、字段与图像原语         | React、DOM、Lucide；无特权 API              |
| `src/features/chat`                 | 对话状态、流式事件、输入与长文展示               | contracts、UI、typed preload                |
| `src/features/shell`                | 侧栏几何、窗口状态与手势生命周期                 | DOM、窗口 preload                           |
| `src/features/preferences`          | 设置持久化与根主题同步                           | localStorage、设置类型                      |
| `src/features/settings` / `account` | 页面组装、设置分类与账号操作                     | UI、typed preload                           |
| `electron/auth` / `chat`            | 安全凭据与远端调用、流式适配                     | Electron、认证库、contracts                 |
| `apps/auth-web/src/auth`            | 系统浏览器登录、凭据请求、桌面授权交接           | auth client、HTTP、UI                       |
| `apps/auth-web/src/security`        | 一次性授权、步骤历史、收件人发送槽与敏感操作呈现 | auth client、HTTP、contracts                |
| `apps/auth-server/src`              | HTTP 组装、认证、授权、模型代理、数据库          | 服务端库、contracts                         |

入口以组装为主。网页 `App` 按路由懒加载页面；服务端 `app.ts` 可被 HTTP 测试加载，`server.ts` 只负责监听和关闭。设置按账号、外观、偏好分类；不按文件行数强行把同一流程拆成无意义的小文件。

聊天状态只有 `chat-store.ts` 一份。发送、编辑重发、请求登记与流式事件同步更新；React 用 `useSyncExternalStore` 读取快照。取消先让请求失效再发 IPC，迟到事件不再修改状态。账号改变时停止所有请求并清除该账号的数据。聊天当前仍保存在内存中，重构没有偷偷引入持久化格式或新的数据迁移。

认证和安全页面将请求逻辑分别放在 `useSignInFlow` 与 `useSecurityFlow`，视图负责布局。步骤历史和发送槽的纯状态转换单独测试；请求有取消、错误码及恢复路径。字段值允许局部状态，多个 state 不等同于错误设计；跨字段的阶段与授权转换必须集中处理。

共享包使用 workspace 依赖，应用不能通过相对路径越界读取另一应用的源目录。contracts 在运行/构建前编译，统一开发命令同时监听 contracts 变更。UI 源码交给应用构建器处理，避免引入第二套 bundler 配置。

`pnpm format` / `format:check` 固定代码风格；`pnpm lint`、`typecheck`、`test` 与 `build` 负责静态与行为检查。数据库通过版本化 SQL 迁移；已部署迁移不改写历史。

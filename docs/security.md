# 认证与敏感操作

## 信任边界

Renderer 只持有可展示资料与会话 ID。Cookie、会话 token 和 PKCE verifier 留在 Electron Main。`apps/desktop/src/main/auth/session-dto.ts` 通过白名单构造设备 DTO；撤销设备时 Main 重新读取本用户的列表，把 ID 解析成服务端所需 token，不允许 renderer 直接指定凭据。

模型请求沿 typed preload → Main → 服务端流动。IPC 和 HTTP 都验证同一个 contracts schema；服务端重新判定有效会话、请求预算与速率限制。会话历史接口与聊天流一样拒绝浏览器 Origin，只接受 Main 携带的会话 Cookie；查询和删除都以 session 中的 `userId` 限定归属，客户端提供的会话或消息 ID 只用于幂等与定位，不能作为授权依据。模型上下文由服务端从持久化历史构造。

Renderer CSP 默认仅允许自身脚本和连接；发布资源不包含 localhost 或开发 WebSocket 白名单。Vite 仅在开发服务中按实际地址放行 HMR，并为 React 前导脚本设置 nonce。构建 mode 不能放宽发布策略；禁止子框架使用 `frame-src`，窗口打开与导航仍由 Main 独立限制。

开发启动显式指定 Electron 参数，不沿用启动插件的 `--no-sandbox` 默认值；开发与发布都保持 Renderer 沙箱、contextIsolation 开启和 nodeIntegration 关闭。

preload 单独打包为 CommonJS 的 `preload.cjs`，只依赖 sandbox loader 允许的 Electron 桥接；不把 ESM 源码格式当作沙箱 preload 的运行格式。[Electron preload 模块说明](https://www.electronjs.org/docs/latest/tutorial/esm#sandboxed-preload-scripts-cant-use-esm-imports)规定该边界。

`frame-src` 限制页面加载子框架，`frame-ancestors` 限制页面被嵌入，两者不互相替代。HTML meta 不支持 `frame-ancestors`，因此不在桌面文件中保留无效声明；本地文件渲染由 Chromium 的来源边界与 Main 导航规则约束。Web 与 Vite 开发服务通过真实 HTTP 响应头发送 `frame-ancestors 'none'`，Web 同时保留 `X-Frame-Options: DENY`。

Web 的动态页面由 Next.js Proxy 为每次响应生成 nonce，并对脚本应用 `strict-dynamic`；生产不允许脚本 `unsafe-inline` 或 `unsafe-eval`，对象与子框架禁止加载。内联样式仍用于头像裁剪、二维码等现有控件，不把脚本策略和样式策略混为一谈。认证与账号根布局保持动态，SSR 页面检查核实实际脚本 nonce，而非只检查配置文本。

所有 `/api/*` 请求在解码 JSON、表单或图片之前限制请求体：一般入口最多 1 MiB，头像上传遵循 contracts 的上传上限。即使没有 `Content-Length` 或声明偏小，也按实际流入字节计数；超限取消读取并返回带本地化文案的 HTTP 413。大小限制与后续来源、会话、schema 和速率校验分别执行。

桌面 Session 显式同时处理权限查询和请求，默认拒绝当前产品未使用的权限。唯一允许项为受信任主页面写入剪贴板；后台读取剪贴板、摄像头、麦克风、屏幕、定位与设备访问均拒绝。IPC 同时校验所属 WebContents 与主 frame，导航与重定向复用同一来源规则，禁止 WebView。刷新、Renderer 崩溃和销毁结束原页面的模型任务。[Electron 权限接口](https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler)要求同时配置查询和请求处理器，不能只依赖沙箱或 CSP。

附件上传显式携带选择时的账号标识，服务端与有效会话核对；标识只约束操作意图，不能授予权限。界面卸载后停止整批文件读取和后续提交，Main 继续绑定凭据快照及登录代次，避免账号切换事件传播期间把旧文件提交到新账号。

## 逐操作授权

登录方式 `amr` 只作审计记录，不再为后续操作授予等级。敏感操作必须获得 `security_operation_grant`：

1. `/api/security/requirements` 提供允许通道；界面只列当前账号实际配置的通道。
2. 用户手动发送验证码，或选择验证器、恢复码、通行密钥。
3. Better Auth 验证凭据；Velin 签发绑定用户、当前会话、操作、资源目标和到期时间的一次性授权。
4. 最终写入端点从 `x-velin-operation-grant` 读取 ID，并原子 `DELETE ... RETURNING` 消费。并发只能成功一次。

授权有效期用于同一张卡片内的验证与操作间隔，不能跨操作复用，也不是“几分钟内免验证”。删除通行密钥额外绑定实例 ID；其他操作的目标是当前用户。服务端策略与真实写入路径集中在 `security/operation-policy.ts`。

通行密钥注册保护 `/passkey/verify-registration`，而非只保护 options 请求。`/password/set` 自身执行授权、统一密码策略、泄露口令检查及退出其他设备，直接调用它也无法跳过这些要求。旧密码路径 `/change-password` 通过当前密码确认，服务端强制 `revokeOtherSessions: true`，调用者省略或传 false 也不能绕过；不再额外叠加一次验证。

凭据变化后取消所有未消费授权。密码验证路径若写入成功但退出其他设备失败，返回明确的部分成功错误，不能显示普通成功。迁移 `007` 删除旧会话字段 `verifiedAt` 与 `stepUpLevel`，授权只由操作授权表管理。

## 凭据验证与来源

- 邮箱验证使用 Better Auth 的 `/email-otp/verify-email`，由库原子消费验证码；`check-verification-otp` 不适合作为一次性授权证据。
- TOTP 与恢复码复用库端点，升级时 `trustDevice: false`。未完成双重认证配置的账号不允许借升级路径完成配置。
- 通行密钥验证要求真实 user verification；验证结果必须属于原会话用户。库创建的临时登录会话立即删除，不把新会话 Cookie 交给升级调用方。
- 自定义 Cookie 路由先校验外层 Origin 和 JSON 内容类型，再构造内部认证请求。没有来源的浏览器敏感请求拒绝；Electron 使用自己的认证 API 通道。
- 生产升级发送与验证按账号计数，并用数据库原子更新处理并发。内部认证调用以不可对外获得的进程标记避免重复落入共享限流桶；直接认证请求仍按库规则限流。Node 入口从真实 socket 获取地址并覆盖客户端地址头。只有 `TRUSTED_PROXY_ADDRESSES` 明确登记的代理才能提供转发链，地址选择由统一的连接边界完成；代理须追加或覆盖 `X-Forwarded-For`，禁止直接透传用户伪造的值。
- 认证限流出口使用标准 `Retry-After` 秒数与中文反馈。pg 的 int8 在应用连接池中解码为 bigint，保持精度并避免认证库计算时间戳时发生字符串拼接，不修改数据库字段或全局解析器。
- 生产强制 SMTP、HTTPS 和禁用开发回码，SMTP 必须使用隐式 TLS 或成功升级 STARTTLS 后才认证；本地 console 邮件与 5 秒冷却只用于开发。
- Better Auth 1.7.6 的 `runInBackgroundOrAwait` 会吞掉邮件失败。`required-delivery.ts` 通过公开的 plugin context 扩展改为等待并传播失败；客户端只有服务端确认投递成功才进入冷却。已有账号可通过邮箱验证码登录入口重新发送，避免以再次注册充当恢复路径。

新密码使用 contracts 中的统一策略：8–32 位英文字母、数字或英文符号，拒绝中文、空格、其他空白字符与控制字符，不强制字符类别。原密码登录继续由认证库校验。密码哈希与校验始终由认证库实现，客户端不处理密码学。

## 请求生命周期

原生凭据请求与 HTTP 共用 AbortSignal；新的凭据动作先取消条件式自动填充，超时会取消实际请求并提供恢复路径。关闭卡片会终止请求，迟到响应不得关闭后来打开的卡片。

`STEP_UP_REQUIRED` 保留机器码。操作过期或授权已消费时，界面回到验证，并在通过后继续原动作。验证码发送状态按收件人保存，切换地址不带入另一地址的结果，也不能通过返回旧地址清除冷却。

## 验证

`apps/web/tests/security.integration.test.ts` 使用 Next.js Route Handler 的 HTTP 请求边界、Better Auth 与 PostgreSQL，覆盖会话、Origin、直接写入、验证码重放、恢复码、授权绑定/过期/并发消费、多设备撤销和数据库限流。

`production-security.integration.test.ts` 另起隔离测试进程，以 production 配置检查 Secure Cookie、客户端地址头防伪、SMTP 连接失败、禁用开发回码及 HTTP 429/Retry-After。OAuth 与模型凭据使用不会对外调用的 fixture；SMTP 失败使用本机未监听端口。

测试数据库必须命名为 `velin_*test`，通过 `VELIN_TEST_DATABASE_URL` 显式选择并先执行迁移。没有该变量时默认测试明确跳过数据库集成部分；发布或认证改动必须另外运行它。测试只清理自己的用户与计数器。

真实邮件供应商、真实设备的通行密钥、Google OAuth 与生产反向代理需要相应环境验收，不能以本地 fixture 替代。

## 登录 MFA 与运维边界

开启双重认证后，密码、邮箱验证码与 Google OAuth 都进入认证库的第二因素挑战，MFA Hook 必须先于 Electron 交接插件执行。挑战完成前没有完整会话或桌面授权码；恢复码由库一次性消费。明确选择信任设备时使用库的限期信任机制。要求用户验证的通行密钥作为独立强认证入口。真实 HTTP 回归覆盖邮箱 OTP、OAuth 回调、恢复码和未验证会话边界。

账号停用、数据保留、文档进程隔离、生产就绪、备份与桌面签名更新见 [部署与恢复](operations.md)。

自有 IPC 请求使用内部结果封装，Main 捕获未知异常并记录固定事件与脱敏分类，preload 只还原本地化失败。只有显式的 `UserFacingError` 可以传递用户文案；原始 Error、cause、Cookie 与第三方诊断对象不会进入 Renderer，也不会交给 Electron 的默认 IPC 异常打印。内部 invoke 助手不在 `window.velin` 上公开，发送方与资源校验继续由各个窄入口执行。

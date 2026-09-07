# Relay 工程规则

Relay 是一个基于 Electron 的 AI 桌面客户端。本文档约束后续在本仓库中的设计、编码、依赖管理和验证方式。

## 技术取向

- 技术栈为 Electron、React、Vite、`vite-plugin-electron`、TypeScript、Oxlint 和 pnpm。
- 新代码优先使用当前稳定版本；存在正式 LTS 版本线时，使用最新 LTS。
- 不要自动选择 alpha、beta、RC、canary、nightly、experimental 或 next 版本。
- 不要因为旧模板曾经这样做就保留过时方案，也不要未经兼容性验证就替换或升级工具链。
- 不使用 Electron Forge。
- 在需求真正出现之前，不提前实现未来阶段的产品功能，也不为假设性问题增加依赖或目录层级。

## 包管理与依赖

- 本仓库只使用 pnpm 管理依赖。
- 不使用 npm、yarn 或 bun 安装项目依赖。
- 必须提交 `pnpm-lock.yaml`；不要生成或提交其他包管理器的 lockfile。
- 保持 pnpm 的严格依赖和安全策略，不要全局放宽构建脚本权限。
- 依赖的 install/build script 必须逐项检查后才能批准，禁止一键批准全部脚本。
- 添加依赖前，先确认它解决的具体问题，并检查平台能力、现有依赖和少量本地实现是否已经足够。
- 新依赖必须与当前技术栈兼容、处于维护状态，并使用经过核验的稳定版本。

## JavaScript 模块规范

Relay 是 ESM 优先的 TypeScript 项目。

- 人工维护的源码默认使用 `.ts` 和 `.tsx`。
- 确实需要 JavaScript 时，在 `package.json` 的 `"type": "module"` 作用域内默认使用 `.js`。
- 不要因为文件用了 `import` / `export` 就自动改成 `.mjs`。
- `.mjs` 只用于运行时或工具明确要求、文件必须独立声明 ESM，或由构建系统自动生成的情况。
- `.cjs` 只用于明确的 CommonJS 兼容边界。
- 默认不要引入 `.mts` 或 `.cts`；只有普通 tsconfig 无法清楚表达同时存在的 ESM/CJS 文件语义时才考虑。
- 不要为了“统一后缀”批量执行 `.js → .mjs` 或 `.ts → .mts` 的无意义迁移。
- 不要手动重命名、删除或修改 `dist/`、`dist-electron/`、`node_modules/` 中的生成文件或第三方文件。

### `vite-plugin-electron` 的特殊情况

- 源码入口保持为 `electron/main.ts` 和 `electron/preload.ts`。
- 构建输出的后缀由当前安装版本的 `vite-plugin-electron` 决定，不要手动统一。
- 在 `type: module` 项目中，main 可能输出为 `dist-electron/main.js`，preload 可能输出为 `dist-electron/preload.mjs`；只要这是工具链的明确行为，就应保留。
- 修改相关配置前，先检查当前安装版本的官方说明和实际构建产物。

## ESM 写法

- 新代码使用 `import` / `export`。
- 除非处于已经记录的 CommonJS 兼容边界，否则不要新增 `require()`、`module.exports` 或 `exports.*`。
- 仅用于类型的依赖必须使用 `import type`；仅用于类型的导出使用 `export type`。
- 遵守 `verbatimModuleSyntax`，不要依赖 TypeScript 自动判断某个 import 是否只用于类型。
- 修改模块边界时，确认 `package.json` 的 `"type"`、TypeScript 配置、Vite 配置和最终运行时行为是一致的。

## TypeScript

- TypeScript 是主要源码语言，保持严格的类型检查方向，不要用 `any` 掩盖错误。
- 优先使用 `unknown`、类型收窄、泛型和明确的领域类型。
- 保持并优先采用 `verbatimModuleSyntax`、`moduleDetection: "force"`、`noEmit`、`jsx: "react-jsx"` 和兼容时的 `erasableSyntaxOnly`。
- Renderer 使用面向浏览器和 Vite 的 `moduleResolution: "bundler"`。
- Vite 配置和 Node 工具代码使用符合实际 Node runtime 的模块设置。
- 浏览器 renderer、Node tooling、Electron main/preload 使用分开的 tsconfig，不要用一套配置混合所有 runtime。
- 不使用 TypeScript enum、namespace、parameter property 等会产生额外运行时代码的语法，除非确有必要。

## React

- 保持 React Strict Mode 开启。
- 组件 render 必须保持纯净。
- 不要用 `useEffect` 处理普通派生状态或同步计算；只有在与外部系统同步时才使用 Effect。
- 订阅、分配资源或注册外部监听器的 Effect 必须提供正确清理逻辑。
- 在真实需要全局状态之前，不引入全局状态库。

## Electron 架构与安全

严格区分 main、preload 和 renderer：

```text
Renderer
  ↓
typed preload API
  ↓
IPC
  ↓
Main
```

- Renderer 是不可信且无特权的 Web 环境。
- Renderer 不得直接访问 Electron API、Node API、文件系统、子进程或 shell。
- `BrowserWindow` 必须保持 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。
- 永远不要把原始 `ipcRenderer` 暴露给 Renderer。
- 只有真实功能需要时，才通过 preload 暴露窄接口、明确类型的 API。
- IPC channel 必须有明确名称、明确输入输出类型，并在需要时校验输入和发送方。
- 不向 Renderer 暴露通用的 `send(channel, ...args)` 或 `invoke(channel, ...args)`。
- 不关闭 `webSecurity`，不启用 `allowRunningInsecureContent` 或实验性 Blink 特性。
- 限制页面导航和新窗口创建；不要把不可信 URL 直接传给 `shell.openExternal`。
- 远程服务使用 HTTPS/WSS，敏感信息不得进入 `VITE_*`、renderer 源码或前端 bundle。
- 不使用 `vite-plugin-electron-renderer`，除非有明确需求并完成安全评估。
- 进入发布阶段前，重新评估是否需要用应用自定义协议替代 `file://` 加载。

## 项目结构

- 在复杂度真正出现之前，保持目录结构小而直接。
- 不要预先创建 `services`、`repositories`、`managers`、`factories`、`utils`、`hooks`、`stores` 等推测性目录。
- 不要为了缩短 import 路径默认建立大规模 barrel-file 或 `index.ts` 汇总树。
- 避免循环依赖；抽象应建立在重复行为已经出现之后，而不是提前设计。
- Renderer 按普通 Vite Web 应用维护，不添加 Node polyfill。

## 生成文件与锁文件

- 不要手动编辑 build 输出、生成的类型文件、lockfile 或生成的 package metadata。
- 生成结果不正确时，修复生成它的源代码或配置，再重新运行对应工具。
- 不要直接修改 `dist/`、`dist-electron/` 和 `node_modules/` 来“修复”问题。

## 任务边界

- 只实现当前明确要求的范围，不提前实现未来阶段。
- 保持改动小、可审查；除非任务确实需要，不顺手重构无关代码。
- 发现无关技术债务时单独报告，不要擅自扩大任务范围。
- 不自动 commit，不自动 push，不重写 Git 历史，不创建或修改 remote。

## 验证要求

结构或代码修改后，至少运行：

```bash
pnpm lint
pnpm typecheck
pnpm build
```

涉及运行时、Electron、preload 或 Vite 配置的修改，还要运行：

```bash
pnpm dev
```

只有验证通过后才能报告任务完成。交付时说明：

- 修改了哪些文件；
- 新增了哪些依赖；
- lint、typecheck、build 和必要的 dev 结果；
- 是否存在未解决的问题。

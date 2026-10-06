# 共享字体资源

来源为 [Adobe Source Han Sans SC 2.005R](https://github.com/adobe-fonts/source-han-sans/tree/2.005R/Variable/WOFF2/TTF)，官方文件与 SHA-256 记录在 `manifest.json`。以此生成的 `Velin Han Sans` 是子集修改版，保留字形设计与产品需要的连续 400–700 可变字重，修改字体内部名称以避开保留名称 `Source`。

字体使用 [SIL OFL 1.1](LICENSE.txt)，可以随 Web 与 Electron 自托管、嵌入及发布；每份 WOFF2 内部保留原始版权，并在 name ID 13 中嵌入完整授权。不要删除这份版权/授权，也不要把修改版重新命名为上游保留名称。应用其他代码的许可不受字体许可影响。

- `common-characters.txt` 是稳定的常用字集合，不随每次应用构建重新扫描源码。增添文字不会缺字，只会按需加载其他分片。
- GB2312 一级常用汉字单独形成正文缓存，其余受支持汉字按 512 个字符分片；保留字库支持的罕见汉字与中文标点，不把聊天输出限制为当前 UI 字符。
- 字体 CSS 在 `../src/chinese-fonts.css`，由生成脚本维护；Latin、数字与半角符号不进入子集，界面使用 Inter，代码使用系统等宽字体。
- 两端使用相同文件；Next 与 Vite 自动处理相对 URL、内容哈希和打包，正常安装、开发、构建都无需 Python 或下载字体。
- 不全量 preload，字体加载使用 swap；Apple 优先原生字体，因此一般不请求这些 WOFF2。Web 的实际下载量取决于当前文字，Electron 发布体积包含所有分片以保证离线覆盖。

## 再生成

仅维护字库时需要 Python 3.9+ 与以下锁定工具，使用独立虚拟环境，不能让工具成为 Renderer 或服务端依赖：

```sh
python3 -m venv /tmp/velin-font-tools
/tmp/velin-font-tools/bin/pip install -r packages/ui/scripts/requirements-fonts.txt
/tmp/velin-font-tools/bin/python packages/ui/scripts/build-fonts.py
pnpm exec prettier --write packages/ui/src/chinese-fonts.css packages/ui/fonts/manifest.json
pnpm --filter @velin/ui test
pnpm build
```

也可传 `--source /absolute/path/SourceHanSansSC-VF.ttf.woff2` 进行离线再生成；脚本必须验证官方源文件的 SHA-256。升级上游字库时明确审查版本、授权、哈希与字符覆盖，再更改脚本；不要在普通构建时自动获取最新字体。生成结果、脚本、manifest 与授权一起提交。

## Inter 西文字体

[Inter 4.1](https://github.com/rsms/inter/releases/tag/v4.1) 的官方发行包与 SHA-256 记录在 `inter-manifest.json`。`Velin Inter` 为西文子集修改版，保留 Latin、组合重音、数字、常用标点及货币符号，中文和全角标点继续使用苹方或思源黑体。正体和真实斜体分成两份 WOFF2，保留 400–700 连续字重与 14–32 光学尺寸；字号、行高、字重角色沿用现有令牌。

完整 [SIL OFL 1.1 授权](INTER-LICENSE.txt) 同时随源码保留并嵌入每份字体的 name ID 13；原始版权保留。`../src/latin-fonts.css` 由维护脚本生成。Apple 原生字体在 Inter 之前匹配，通常无需下载 Inter；其他平台按出现的正体 / 斜体下载，系统字体在失败时回退。无 CDN、无全局预加载、无浏览器平台探测，普通构建只消费已提交的资源。

使用上面的同一套 Python 环境再生成，无需增加依赖：

```sh
/tmp/velin-font-tools/bin/python packages/ui/scripts/build-inter.py
pnpm exec prettier --write packages/ui/src/latin-fonts.css packages/ui/fonts/inter-manifest.json
pnpm --filter @velin/ui test
pnpm build
```

离线生成可传 `--source /absolute/path/Inter-4.1.zip`。修改发行版本或字符范围时审查授权、校验哈希、核对真实斜体与字符覆盖；不能让普通构建自动获取最新字体。

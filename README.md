# Debug Agent 浏览器扩展（MV3）

面向“线上项目无 source-map 的前端异常定位”场景的浏览器扩展：通过 `chrome.debugger`（Chrome DevTools Protocol）+ 页面注入 hooks，在不改业务代码的前提下尽可能完整地采集异常，并提供：

- 录制：采集控制台错误、未捕获异常、Promise 拒绝、资源加载失败、网络请求失败等
- dist 定位：从堆栈帧定位到 `chunkUrl:line:column`，拉取并展示对应构建产物片段
- 断点与快照：对指定位置自动下断点，暂停后抓取 callFrames / scope / this / Vue2 线索等运行时快照
- AI 辅助：可选调用 Qwen（DashScope OpenAI Compatible）生成原因与修复建议（需要 API Key）

## 目录

- [快速开始](#快速开始)
- [如何使用](#如何使用)
- [项目结构](#项目结构)
- [常用命令](#常用命令)
- [环境变量](#环境变量)
- [能力与限制](#能力与限制)
- [排错](#排错)

## 快速开始

### 依赖要求

- Node.js：`>= 22.15.1`（见根目录 `package.json#engines`）
- pnpm：`pnpm@10`（建议全局安装：`npm i -g pnpm`）

安装依赖（首次会自动把 `.example.env` 复制为 `.env`）：

```bash
pnpm install
```

### Chrome（开发）

1. 启动开发构建（会 watch 并把产物输出到根目录 `dist/`）：

```bash
pnpm dev
```

2. 打开 `chrome://extensions`，开启“开发者模式”
3. 点击“加载已解压的扩展程序”，选择本项目的 `dist/` 目录

### Chrome（生产构建 / 打包）

```bash
pnpm build
pnpm zip
```

`pnpm zip` 会把 `dist/` 打包到 `dist-zip/extension-*.zip`（用于分发或 e2e）。

### Firefox（开发 / 构建）

```bash
pnpm dev:firefox
pnpm build:firefox
```

- 打开 `about:debugging#/runtime/this-firefox`
- 选择 “Load Temporary Add-on...”
- 选择 `./dist/manifest.json`

## 如何使用

1. 打开你要排查的网页
2. 点击扩展图标打开 Popup（入口：`pages/popup`）
3. 点击 Start/开始录制（会 attach debugger 并启用 Runtime/Log/Network，同时注入页面 hooks）
4. 在页面上复现问题
5. 在 Popup 的日志列表中选择一条错误：
   - Analyze：拉取该堆栈定位到的 dist 文件片段，并给出初步分类与排查建议
   - Arm BP：按 `url + line(+column)` 自动设置断点；回到页面再次复现后会暂停
6. 页面暂停后，Popup 会出现运行时快照（Debugger.paused）：
   - 可查看截断后的局部变量、this 预览、Vue2 线索（若可推断）
   - 点击 Resume 继续执行
7. 需要 AI 辅助时：在 Popup 下方填写 Qwen/DashScope API Key，点击 AI Analyze

## 项目结构

本仓库是一个 pnpm workspace + turborepo 的 monorepo，核心模块如下：

```
.
├─ chrome-extension/          # 扩展构建入口：生成 manifest + 构建 MV3 background
│  ├─ manifest.js             # manifest 源（构建生成 dist/manifest.json）
│  ├─ src/background/         # service worker（监听、录制、断点、快照、AI 调用）
│  └─ vite.config.js
├─ pages/
│  └─ popup/                  # 扩展弹窗 UI（React + Tailwind）
├─ packages/                  # 共享包（env/hmr/storage/shared/ui/vite-config 等）
├─ services/
│  └─ agent-server/           # 可选：简易事件/任务服务（HTTP，默认 8787）
└─ tests/
   └─ e2e/                    # e2e（基于打包后的扩展）
```

## 常用命令

在仓库根目录执行：

```bash
pnpm dev               # 开发构建（watch），产物输出到 dist/
pnpm build             # 生产构建
pnpm zip               # build 后打 zip（dist-zip/）
pnpm lint              # 全仓 lint
pnpm format            # 全仓 prettier
pnpm update-version 0.1.0   # 批量更新各包版本号
```

只对某个 workspace 执行（示例）：

```bash
pnpm -C chrome-extension lint
pnpm -C pages/popup dev
pnpm -C services/agent-server dev
```

安装依赖：

```bash
pnpm i <package> -w                 # 安装到根 workspace
pnpm i <package> -F <workspaceName> # 安装到指定模块（见各自 package.json 的 name）
```

## 环境变量

本项目使用 `packages/env` 将 `.env` 注入到构建（在 Vite 配置中通过 `define: { 'process.env': env }`）。

- `.env` 中可编辑的键必须以 `CEB_` 开头（示例见 `.example.env`）
- 通过 CLI 注入的键必须以 `CLI_CEB_` 开头（由 `pnpm set-global-env ...` 写入 `.env` 的 CLI 区域）
- 内置开关：
  - `CLI_CEB_DEV`：是否开发模式（`pnpm dev` 会自动设置为 true）
  - `CLI_CEB_FIREFOX`：是否 Firefox 构建（`pnpm dev:firefox / build:firefox` 会自动设置）

更多细节见：`packages/env/README.md`。

## 能力与限制

### 能捕获的（高覆盖）

- JS 运行时未捕获异常（CDP `Runtime.exceptionThrown`）
- Promise 未处理拒绝（注入 `unhandledrejection`）
- 控制台错误（CDP `Runtime.consoleAPICalled`，主要关注 `console.error`）
- 资源加载失败（注入捕获 `error` 事件：script/css/img 等）
- 网络请求失败/慢请求线索（Network 域 + fetch/XHR hooks）
- Vue2 场景：可尝试通过运行时对象推断组件/路由线索（用于无 sourcemap 的归因）

### 典型盲区（物理限制）

- 跨域 iframe 内部错误（无法向跨域 frame 注入脚本）
- Web Worker / Service Worker 内错误（默认 attach 主 Tab，不覆盖独立 worker 上下文）
- 被业务 `try/catch` 完全吞掉且未打印/上报的错误
- “静默逻辑错误”（不抛异常、结果不对）
- 页面极早期错误（存在极小注入时间窗口）

## 排错

### 1) 录制后没有任何日志

- 确认扩展已加载的是最新 `dist/`（重新加载已解压扩展）
- 确认目标页面不是特殊页面（如 Chrome Web Store / 内置页面等）
- 确认权限允许：manifest 默认包含 `host_permissions: ["<all_urls>"]` 与 `debugger` 权限

### 2) 断点无法命中

- 该错误是否可复现（断点需要再次触发到相同位置）
- 堆栈定位是否来自同一个 chunk URL（动态加载/版本切换会导致 URL 变化）
- 生产环境压缩下 column 可能漂移，建议优先按 line 设置断点（或在 UI 中调小对 column 的依赖）

### 3) AI 分析报错（Qwen）

- 401：Key 无效/过期（在 Popup 中重新填写 DashScope API Key）
- 429：频率/配额不足（稍后重试或检查账户额度）
- 403：无权限访问模型（检查账号权限或模型是否可用）

# pages/popup

这是扩展的 Popup 页面（用户点击浏览器工具栏图标时展示的 UI），基于 React + Vite 构建。

## 功能概览

- 录制控制：对当前激活 tab 启动/停止采集（Start/Stop），并实时刷新日志/快照数据
- 日志查看：展示采集到的异常/console/network 等日志条目
- dist 分析：对选中的错误日志拉取对应产物并生成可读片段（用于定位问题上下文）
- AI 诊断：把（错误日志 + dist 片段）发送给 background，由 background 调用大模型生成排查建议（需要配置 Qwen Key）
- 快照联动：在 Agent 模式下支持“等待复现 → 自动停止录制 → 继续分析”的闭环

## 目录结构

```text
pages/popup
├─ public/                 Vite publicDir（构建时原样拷贝）
│  ├─ logo_vertical.svg            Popup 内使用的 Logo（浅色）
│  └─ logo_vertical_dark.svg       Popup 内使用的 Logo（深色）
├─ src/                    源码目录（React）
│  ├─ components/
│  │  ├─ AiPanel.jsx               AI 分析面板：Key/模式选择、触发分析、展示结果
│  │  ├─ AnalysisPanel.jsx         分析区：错误日志 + dist 分析结果 + AI 面板容器
│  │  ├─ CodeSnippet.jsx           代码片段展示：行号、JS 高亮、错误列 token 标红
│  │  └─ LogList.jsx               日志列表：选择日志、展示定位、支持“断点调试”按钮
│  ├─ hooks/
│  │  └─ usePopupRecorder.js       录制器 hook：拉取状态/logs/snapshots，监听更新消息并 refresh
│  ├─ utils/
│  │  ├─ chrome.js                 chrome.runtime/tabs 通信封装（含 lastError 兜底、取 activeTabId）
│  │  ├─ distSnippet.js            dist 片段提取/格式化（供 dist 分析与展示使用）
│  │  └─ popupAnalysis.js          日志分析核心：错误类型分类、主帧定位、拉取产物并生成上下文片段
│  ├─ Popup.jsx            Popup 主界面
│  ├─ Popup.css                   Popup 页面样式（日志列表、分析区、代码片段等）
│  ├─ index.jsx                   入口：挂载 React root 到 #app-container 并渲染 Popup
│  └─ index.css                   基础样式：引入 UI 全局样式、设置 popup 尺寸与容器布局
├─ index.html              Vite 入口 HTML（包含 #app-container 与入口脚本）
├─ README2.md              采集覆盖/盲区说明（历史文档，内容已合并到本 README）
├─ tailwind.config.js      Tailwind 配置（复用 @extension/ui 预设，并声明扫描范围）
├─ vite.config.js          Vite 构建配置（@src alias、publicDir、outDir=dist/popup）
└─ package.json            子包依赖与脚本（build/dev/lint/format 等）
```

## 本地开发与构建

在仓库根目录使用 pnpm workspace（推荐）：

```bash
pnpm -C pages/popup build
pnpm -C pages/popup dev
pnpm -C pages/popup lint
```

- `dev` 在此项目里是 `vite build --mode development`（用于扩展打包流程），不是启动 Vite dev server
- 构建产物输出到 `dist/popup`（见 `pages/popup/vite.config.js`）

## 关键实现点

### 与 background 通信

- `src/utils/chrome.js`
  - `sendRuntimeMessage`：封装 `chrome.runtime.sendMessage` 并统一兜底 `chrome.runtime.lastError`
  - `getActiveTabId`：获取当前窗口激活 tabId

### Popup 侧状态与自动刷新

- `src/hooks/usePopupRecorder.js`
  - 启动时获取 active tabId，并拉取 recorder 状态 / logs / snapshots
  - 监听 `AGENT_LOGS_UPDATED` 与 `AGENT_SNAPSHOTS_UPDATED`，对当前 tab 自动 refresh

### dist 分析（定位产物片段）

- `src/utils/popupAnalysis.js`
  - `pickPrimaryFrame`：从堆栈帧中选择“最可能属于业务代码”的定位帧
  - `analyzeLog`：拉取 `primaryFrame.url` 对应的生成代码，结合 `distSnippet` 提取/格式化上下文片段

### Qwen Key 存储

- `src/Popup.jsx` 使用 `chrome.storage.local` 存取 key：`agent.qwenKey.v1`

## 采集覆盖与盲区（实现边界）

通过 `chrome.debugger`（CDP）+ 注入 hooks（`chrome.scripting`，MAIN world）组合，通常能捕获：

1. JS 运行时异常：未捕获的 throw
2. Promise 拒绝：未处理的 unhandledrejection（注入监听并转成 console.error）
3. 控制台错误：console.error / console.assert（CDP `Runtime.consoleAPICalled`）
4. HTTP 4xx/5xx：CDP `Network.responseReceived` 对 `status>=400` 记录日志
5. 网络层失败：CDP `Network.loadingFailed` + fetch/XHR hook 辅助输出
6. 框架特定错误：例如 Vue2 的 errorHandler（注入劫持并转成 console.error）

天然盲区（当前实现方式下不稳定或不覆盖）：

1. 跨域 iframe 内的错误（注入受同源/权限限制）
2. Web Workers / Service Workers（独立上下文未自动 attach/注入）
3. 被 try...catch 吞掉且没有显式上报/console 的错误
4. 逻辑错误（Silent Failures：不抛错、不打印）
5. 扩展自身（background/service worker）内部报错
6. 点击 Start 之前发生的错误（不做回溯补采）

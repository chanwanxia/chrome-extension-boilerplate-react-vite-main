# chrome-extension

本目录是扩展的“构建与产物入口” workspace，负责：

- 生成扩展根目录的 `manifest.json`（源为 [manifest.js](./manifest.js)）
- 构建 MV3 background service worker（入口为 [src/background/index.js](./src/background/index.js)，产物为 `dist/background.js`）
- 开发模式下注入 refresh/HMR 脚本（由 [make-manifest-plugin.js](./utils/plugins/make-manifest-plugin.js) 处理，生成 `dist/refresh.js` 并追加 content-script）

本模块只负责“扩展根目录 + Service Worker”相关产物；Popup UI、可选的其他页面（options/newtab/devtools/sidepanel）位于 `pages/*`，共同输出到仓库根目录的 `dist/`。

## 构建产物（输出到根目录 dist/）

- `dist/manifest.json`：由 `chrome-extension/manifest.js` 动态生成（支持 dev/firefox 变体处理）
- `dist/background.js`：MV3 service worker 入口（由 Vite lib 模式构建）
- `dist/refresh.js`：仅开发模式生成，用于触发扩展自动 reload/refresh（通过额外 content-script 注入）
- `dist/icon-*.png`、`dist/content.css`：来自 `chrome-extension/public/` 的静态资源

## 常见开发命令

推荐在仓库根目录执行（一次性构建所有模块到同一个 `dist/`）：

```bash
pnpm dev
pnpm build
pnpm zip
```

也可以仅构建本模块（同样输出到根目录 `dist/`；这是“build + watch”，不是 Vite dev server）：

```bash
pnpm -C chrome-extension lint
pnpm -C chrome-extension dev
pnpm -C chrome-extension build
```

开发构建完成后，在 Chrome 中加载：

1. 打开 `chrome://extensions`，开启“开发者模式”
2. 点击“加载已解压的扩展程序”
3. 选择仓库根目录下的 `dist/`

## 自定义 manifest

编辑 [manifest.js](./manifest.js)：

- `version` 会读取本模块的 `package.json#version`
- 可按需开启/配置：`options_page`、`devtools_page`、`chrome_url_overrides`、`side_panel` 等
- Firefox 兼容：
  - `browser_specific_settings.gecko.id` 需要全局唯一（用于 AMO）
  - `sidePanel` 权限/字段在 Firefox 不支持，会在生成阶段被转换/剔除（由 `ManifestParser` 处理）

## 目录结构与职责

```
chrome-extension/
  ├─ public/                 # 静态资源（直接打包到扩展根目录）
  │  ├─ content.css          # 内容脚本可引用的公共样式
  │  └─ icon-*.png           # 扩展图标资源
  │
  ├─ src/                    # 核心源码目录
  │  └─ background/          # MV3 后台 Service Worker（核心逻辑）
  │     ├─ index.js          # 入口文件：统一注册所有监听器
  │     ├─ const/            # 全局常量定义
  │     │  └─ index.js       # storage key、消息类型、协议版本等
  │     ├─ listeners/        # 浏览器事件监听
  │     │  ├─ runtime.js     # runtime 监听入口（对外统一导出，内部按模块拆分）
  │     │  ├─ runtime/       # runtime 监听实现：录制、断点、快照、AI 等
  │     │  │  ├─ debugger.js
  │     │  │  ├─ messages.js
  │     │  │  └─ ai.js
  │     │  └─ tabs.js        # 标签页事件：关闭时自动清理状态
  │     ├─ messages/         # 跨上下文消息通信处理
  │     │  ├─ index.js       # 消息路由：分发到对应处理器
  │     │  ├─ popupMessages.js      # 处理来自 popup 的指令
  │     │  └─ contentMessages.js    # 处理来自 content-script 的消息
  │     └─ services/         # 业务服务层
  │        ├─ aiService.js     #  AI错误诊断
  │        ├─ storageService.js     # 存储封装（Promise 化）
  │        ├─ errorService.js       # 错误/日志/快照处理
  │        └─ performanceService.js     # 网络请求监控与慢日志分析
  │
  ├─ utils/
  │  └─ plugins/
  │     └─ make-manifest-plugin.js  # Vite 插件：生成 manifest + 开发热重载
  │
  ├─ manifest.js             # 扩展配置源文件（构建生成 manifest.json）
  ├─ vite.config.js          # Vite 构建配置
  └─ package.json            # 脚本、依赖、workspace 配置
```

## 排错

- Service Worker 没更新：Chrome 扩展是“解压加载”，通常需要在 `chrome://extensions` 点击刷新该扩展；或在扩展详情页打开 “Service worker” 的 Inspect 重新加载。
- 开发模式没有自动刷新：确认使用 `pnpm dev` 或 `pnpm -C chrome-extension dev` 构建，且 `dist/refresh.js` 存在；再刷新目标页面触发 content-script 注入。
- `dist/` 内容异常混杂：本仓库多个模块共享输出目录（根目录 `dist/`），本模块的 `vite.config.js` 会设置 `emptyOutDir: false`，避免互相清空产物。


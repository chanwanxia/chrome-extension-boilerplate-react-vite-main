# chrome-extension

本目录是扩展的“构建与产物入口”包，负责：

- 生成 `manifest.json`（由 [manifest.js](file:///Users/chenwanxia/Desktop/keendata/test/agent/chrome-extension-boilerplate-react-vite-main/chrome-extension/manifest.js) 动态产出）
- 构建 MV3 background service worker（入口为 [src/background/index.js](file:///Users/chenwanxia/Desktop/keendata/test/agent/chrome-extension-boilerplate-react-vite-main/chrome-extension/src/background/index.js)）
- 在开发模式下注入 HMR/refresh 脚本（由 `make-manifest` 插件处理）

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
  │     │  ├─ runtime.js     # 调试器/运行时事件：录制、断点、快照、消息分发
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

## 常见开发命令

在仓库根目录执行：

```bash
pnpm -C chrome-extension lint  # 在 chrome-extension 目录执行 lint
pnpm -C chrome-extension dev
pnpm -C chrome-extension build
```


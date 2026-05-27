“无 source-map 的线上 Vue2 项目”想自动化定位 ，本质上不能靠“dist → source 精确映射”，而要把传统手工在 DevTools 里做的两件事自动化：
1. 把异常捕获得更完整 （包括控制台没报错、Promise 吞掉、Vue 自己捕获的错误）
2. 把“在 Sources 打断点观察上下文”变成机器可执行流程 （拿到 chunk/行列 → 自动下断点/暂停 → 抓取 callFrames/局部变量/this/vm → 结合 dist 上下文 + 特征检索推断“可能的源码文件/逻辑”）
下面给一个面向“公司所有线上项目（多 Vue2、无 sourcemap）”可落地的 agent 设计。

## 一、总体架构（推荐：浏览器插件 + 后端分析服务）
- 浏览器侧（Extension / DevTools 扩展）
  - 负责：采集异常、抓取 dist 代码上下文、必要时“自动断点 + 取运行时变量快照”
  - 技术核心：Chrome DevTools Protocol（通过 chrome.debugger ）、页面注入（patch Vue/error hooks）、网络采集（Network 域）
- 后端侧（Agent Server）
  - 负责：归档事件、拉取对应 chunk、做静态/半静态分析、做“源码仓库特征索引检索”、输出诊断报告
- 可选：CI 索引器（强烈建议）
  - 在不引入 sourcemap 的前提下，为每次发布生成“可检索指纹索引”（下面第六部分会讲），否则“推断源码文件”只能靠启发式，命中率有限

## 二、采集层：如何在“控制台可能没报错”时仍捕获到异常
### 1) 不依赖控制台：直接抓 Runtime 异常
- 通过 CDP 监听： Runtime.exceptionThrown
- 同时启用： Log.enable 、 Runtime.enable
### 2) Promise/异步吞错
- 通过页面注入（page world）：
  - window.addEventListener('unhandledrejection', ...)
  - window.addEventListener('error', ...) （含资源加载错误：script/css/img）
### 3) Vue2 自己捕获的错误（控制台可能只 warn 或被框架吞掉）
- 注入 patch：
  - Vue.config.errorHandler = (err, vm, info) => ...
  - Vue.config.warnHandler = (msg, vm, trace) => ...
- 关键收益：你会拿到 vm ，这对“无 sourcemap 定位源码”非常重要（可导出 $options.name 、 $route 、组件层级链等）

## 三、定位层：没有 source-map，怎么“自动化 Sources 断点排查”
你说的正常排错方式是 Sources 里打断点排查——这一步其实可以被 CDP 自动化：
### 1) 从堆栈拿到 chunk/行/列
- 主要来源：
  - Runtime.exceptionThrown 的 stackTrace.callFrames
  - 或 console.error 的 stack（若可得）
### 2) 自动下断点 + 让程序在同一位置暂停
- Debugger.enable
- Debugger.setBreakpointByUrl({ url: chunkUrl, lineNumber, columnNumber })
- 然后触发一次“同类动作”或者等待下次同类异常（可结合“录制用户操作”做半自动复现）
### 3) 暂停后抓取“你手工在 Scope 面板里看的东西”
- Debugger.paused 事件触发后：
  - callFrames[] 里有 callFrameId
  - 用 Debugger.evaluateOnCallFrame 抓：
    - 局部变量（需要枚举 scopeChain）
    - this
    - Vue 场景：尝试从 this 推断 vm （很多情况下 handler 里 this 就是组件实例或其代理）
- 这一步的价值远超“上下文 10 行代码”，因为 无 sourcemap 时，真正能把“chunk-libs”指向业务模块的，是运行时对象与数据路径

## 四、代码上下文：dist 精确行列 + 上下文切片（即使压缩也有用）
仍然保留你最初的思路，但目标从“映射回源码”改为“提取可检索特征”：

- 拉取 chunk-xxx.js （同源可直接 fetch；跨域可由后端代拉，或用 chrome.debugger 的 Network.getResponseBody 配合捕获到的 response）
- 定位到行列附近：
  - 压缩产物通常“一行很长”，所以除了“上下 10 行”，更有效的是：
    - 按列截取窗口 （例如 column±5000 chars）
    - 对截取片段做 beautify（不需要完整格式化全文件）

## 五、特征提取与归因：在没有 source-map 时如何推断“源码文件/逻辑/原因”
### 1) 特征提取（用于检索与聚类）
- 运行时特征：
  - Vue： vm.$options.name 、 vm.$route.fullPath/name 、组件父链（name 列表）
  - 关键业务数据 key（从局部变量/this 中做浅层提取与脱敏）
- 静态特征：
  - dist 片段里的字符串字面量（接口路径、埋点名、错误码、文案 key）
  - 标识符（函数名/变量名，哪怕被压缩也常保留部分 export 名、库名、枚举 key）
  - 关键调用形态（axios/fetch、Vuex dispatch、router push 等）
### 2) “源码定位”不要承诺精确文件，而是输出候选集 + 证据
- 输出形态建议：
  - Top N 可能源码文件/模块
  - 每个候选给证据：
    - 命中的字符串/接口路径/埋点名
    - 命中的组件名/路由名
    - dist 片段摘要（去噪后）
    - 运行时变量快照摘要
    
## 六、命中率的关键：引入“无 sourcemap 的可检索索引”（CI 生成）
如果你希望“自动推断源码文件”在全公司项目上稳定可用，建议增加一个 不等同于 source-map、但能检索映射的发布索引 ：

- CI 在构建时生成两类索引（并上传到后端）：
  1. 源码索引 ：对每个文件/函数块生成 fingerprint（token shingles、字符串集合、AST 结构摘要）
  2. dist 片段索引 ：对产物按 chunk 分块（例如每 5KB 一块）生成 fingerprint
- 线上拿到“dist 片段”后，用 fingerprint 去匹配源码索引，得到候选文件
- 这不会暴露完整源码，也不需要把 .map 发布到公网；只需要公司内部服务能访问索引即可

## 七、你要的核心流程（在无 source-map 语境下的“正确版本”）
- 捕获异常（Runtime/Vue/error/unhandledrejection）
   → 解析堆栈拿到 chunk/行/列
   → 拉取 dist 片段（列窗口 + beautify）
   →（可选）自动断点暂停抓运行时变量快照
   → 特征提取（字符串/标识符/路由/组件链/请求信息）
   → 后端：索引检索 + 规则/LLM 归因（输出候选源码模块、可复现路径、最可能原因）
如果你愿意，我可以按这个“无 sourcemap 的正确目标”把当前原型进一步调整成更贴近现实的版本：重点做 Debugger 自动断点 + paused 时抓 scopeChain/this/vm ，并把“源码定位”从 sourcemap 改为“候选模块推断 + 证据链”。

<!-- 2 -->
## 怎么用（对应你说的真实排错流程）
- 点 Start ：开始监听 console/exception，同时安装页面 hooks
- 看到一条疑似错误日志：
  - 点 Analyze ：抓取 chunk 文件并展示 column 附近 dist 片段 + 特征提取
  - 点 Arm BP ：自动在该 chunk 的行列位置设置断点
- 回到页面复现操作 → 页面暂停后 Popup 会出现 运行时快照（Debugger.paused） （包含局部变量/this/Vue 线索）→ 点 Resume 继续执行
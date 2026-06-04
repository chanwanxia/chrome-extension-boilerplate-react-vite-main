✅ 能够捕获的错误（高覆盖率）

通过 `chrome.debugger`（CDP）和 `chrome.scripting`（向页面 MAIN world 注入 hooks）的配合，它能捕获大多数“会显式冒泡为错误事件/错误日志”的问题（前提：先点击 Start）：

1. JS 运行时异常：未捕获的 throw 错误
* 原因：CDP Runtime 能拿到未捕获异常；
* 结果：记录为异常日志。

2. Promise 拒绝：未处理的 unhandledrejection
* 原因：注入 `window.addEventListener('unhandledrejection')` 并转成 `console.error`
* 结果：能在 Popup 看到对应日志）。

3. 控制台错误：业务代码主动调用的 `console.error / console.assert`
* 原因：CDP `Runtime.consoleAPICalled`；
* 结果：能采集到参数拼接后的 message。

4. HTTP 4xx/5xx：XHR/Fetch 与核心资源的非 2xx
* 原因：CDP `Network.responseReceived` 对 `status>=400` 记一条网络错误日志；
* 结果：Popup 能看到类似 `[API] ... status=404` 的日志。

5. 网络层失败：fetch/XHR 的断网/DNS/被阻止等
* 原因：CDP `Network.loadingFailed` + 注入的 fetch/XHR hook 会额外输出错误；
* 结果：Popup 能看到失败日志或 `Failed to fetch/net::ERR...` 等信息。

6. 框架特定错误：Vue2 渲染/生命周期错误
* 原因：注入劫持 `Vue.config.errorHandler` 并转成 `console.error`；
* 结果：Popup 能看到包含组件/信息的日志

❌ 无法捕获的错误（盲区）

这是当前实现方式（对当前 tab attach + 仅在顶层 MAIN world 注入 hooks）天然存在的边界：

1. 跨域 iframe 内的错误
 * 原因：出于同源策略与注入限制，扩展无法稳定向跨域 iframe 注入 hooks。
 * 结果：跨域 iframe 内发生的 `unhandledrejection`/框架 hook 等信息，通常不会出现在 Popup 的采集日志里（即使偶尔能看到部分 CDP 侧异常，也不完整）。

2. Web Workers / Service Workers
 * 原因：Worker 运行在独立线程/上下文，当前不会对 worker target 自动注入 hooks，也不会自动 attach 到对应 worker。
 * 结果：Worker 内部抛出的异常/拒绝，通常不会出现在 Popup 日志里。

3. 被 try...catch 吞掉的错误
 * 原因：如果开发者写了 `try { ... } catch(e) { /* 什么都不做 */ }`，错误被静默处理。
 * 结果：除非在 catch 里显式 `console.error` 或主动上报，否则扩展不知道错误发生过。

4. 逻辑错误（Silent Failures）
 * 原因：代码没有崩溃，但结果不对（状态错误/分支写错/返回结构不符合预期等）。
 * 结果：没有异常抛出、没有错误日志/错误事件触发，就不会被采集。

5. 扩展自身的错误
 * 原因：Popup 展示的是“某个 tab 的页面侧采集结果”，不是扩展 background/service worker 自己的错误面板。
 * 结果：扩展自身崩溃/报错不会作为页面日志出现在 Popup 中。

6. 点击 Start 之前发生的错误
 * 原因：采集是在 Start 时才 attach + 注入 hooks，无法回溯补采。
 * 结果：页面早期报错/早期网络请求失败，可能完全不在日志里。

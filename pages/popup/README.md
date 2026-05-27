✅ 能够捕获的错误（高覆盖率）

    通过 chrome.debugger (CDP) 和 chrome.scripting (注入脚本) 的配合，它能捕获绝大多数显式抛出的错误：

     1. JS 运行时异常：未捕获的 throw 错误（通过 Runtime.exceptionThrown）。
     2. Promise 拒绝：未处理的 unhandledrejection（通过注入的 window.addEventListener）。
     3. 控制台错误：业务代码主动调用的 console.error（通过 Runtime.consoleAPICalled）。
     4. 资源加载失败：图片、CSS、Script 加载 404 或网络错误（通过注入的 error 事件捕获）。
     5. 网络请求失败：fetch 或 XMLHttpRequest 的网络层报错（通过重写 window.fetch 和 XHR.prototype 拦截）。
     6. 框架特定错误：如 Vue 的渲染错误（通过 Vue.config.errorHandler 劫持）。

 ❌ 无法捕获的错误（盲区）

    这是所有基于 Chrome Extension 的监控方案都面临的物理限制：

    1. 跨域 iframe 内的错误
     * 原因：出于安全策略（Same-Origin Policy），扩展无法向跨域 iframe 注入脚本。
     * 结果：如果错误发生在 https://other-domain.com 的 iframe 中，且该域名没有安装你的扩展，主页面无法捕获这些错误。

    2. Web Workers / Service Workers
     * 原因：Worker 运行在独立的线程/上下文中，chrome.debugger 默认 attach 的是主 Tab（Main World）。
     * 结果：Worker 内部抛出的异常不会触发主线程的 exceptionThrown 事件。

    3. 被 try...catch 吞掉的错误
     * 原因：如果开发者写了 try { ... } catch(e) { /* 什么都不做 */ }，错误被静默处理了。
     * 结果：除非业务代码在 catch 块里显式调用 console.error 或你的上报接口，否则扩展完全不知道错误发生过。

    4. 逻辑错误 (Silent Failures)
     * 原因：代码没有崩溃，但结果不对（例如：if (a == b) 写成了 if (a = b)，或者状态机卡死）。
     * 结果：没有异常抛出，没有任何错误事件触发。

    5. 扩展自身的错误
     * 原因：这个监控工具是“旁观者”。
     * 结果：它只能监控目标网页的错误，无法监控它自己（Background Script 或 Content Script）内部发生的崩溃。

    6. 页面加载极早期的错误
     * 原因：虽然扩展会在 tabs.onUpdated 时尽快注入脚本，但如果页面在 DOMContentLoaded 之前立即报错，可能存在极小的时间窗口导致漏抓。
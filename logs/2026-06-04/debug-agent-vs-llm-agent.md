# debug-agent 与 LLM 智能体差异（2026-06-04 09:54～10:00）

## 1. 用户提问
当前项目自称 debug-agent。请基于现有实现判断：它是否只是一次性调用 Qwen 做单次问答/生成，而不是具备自主规划与执行闭环的完整智能体系统？

## 2. AI完整回复
从代码现状看，你的判断基本成立：这个项目更像“带可选 LLM 辅助的 Debug 工具/扩展”，而不是“具备自主规划与执行闭环的智能体系统”。

- AI 部分是一次性生成：后台的 aiAnalyze 只是把（错误对象 + dist 片段 + meta）拼成 prompt，然后请求一次 DashScope OpenAI Compatible 的 chat/completions，拿到文本后尝试解析 JSON 返回。没有多轮对话、没有工具调用、没有自我迭代循环。实现证据：chrome-extension/src/background/services/aiService.js:L26-L142；chrome-extension/src/background/listeners/runtime.js:L338-L360。
- 核心能力是“确定性调试采集/控制”而非 agent loop：主要逻辑是 attach chrome.debugger、订阅 CDP 事件（Runtime/Log/Network/Debugger）、注入 hooks、设置断点、暂停后抓取 callFrames/scope/this/Vue2 线索并落快照。这些都是“工具能力本身”，不依赖模型来决定下一步做什么。实现证据：chrome-extension/src/background/listeners/runtime.js:L99-L337。
- 所谓 agent-server 目前只是轻量事件/任务列表：services/agent-server 里 analyze-error 任务是同步拼一个固定的 nextSteps，不做模型调用，也没有任务调度/执行器/状态机/重试等“智能体编排”。实现证据：services/agent-server/src/index.js:L80-L123。

为什么 README 叫 debug-agent 仍然说得通（但容易产生误解）：
- 这里的 agent 更像“自动化代理/探针”：它能在不改业务代码的情况下自动采集与自动下断点抓快照，从工程角度确实是在“代你执行调试动作”。
- 但从“LLM 智能体系统”的常见定义（Plan → Act(tool) → Observe → Re-plan，多步任务闭环、工具选择、记忆/状态、失败恢复）来看，这个仓库目前还没形成智能体闭环，LLM 只是一个可选的后处理“建议生成器”。

如果你的目标真的是“完整 debug-agent（LLM agent）”，通常至少要补齐：
- 任务编排与循环：把“分析→决定下一步→执行 CDP 工具→读回结果→继续”做成可迭代的状态机/循环
- 工具层：把 CDP 能力（拉更多上下文、加/删断点、抓变量、抓网络瀑布等）抽象成可调用工具，并让模型基于观察结果选择工具
- 记忆与上下文管理：跨步骤/跨事件的上下文压缩、去重、证据引用与可追溯（而不只是一次性把 dist 片段塞进 prompt）

## 3. 核心知识点总结
- 关键结论：当前实现是“调试采集/控制工具 + 可选一次性 LLM 诊断”，不是具备闭环的 LLM 智能体。
- 易错点/踩坑点：把“有 LLM 调用”误认为“有 agent”；缺少 plan/act/observe/replan、工具选择与多步状态管理时，本质仍是单次生成。
- 推荐方案与取舍：先把 CDP 能力产品化为稳定工具层，再引入编排/循环；否则模型输出缺少可执行性与可验证证据链。
- 可复用的规范/模板：将“结论”与“证据（日志/快照/代码引用）”强绑定输出，避免无依据的归因。

## 4. 项目落地建议
- 贴合当前项目的落地步骤：把现有 CDP 操作封装为可调用工具 → 定义一个多步任务状态机（含重试/超时/终止）→ 增加 observe→replan 的循环与上下文压缩 → 在 UI 上展示“每一步动作与证据”。
- 需要改动的文件/模块（如适用）：chrome-extension/src/background/listeners/runtime.js（任务编排入口）、chrome-extension/src/background/services/*（工具层）、packages/protocol（任务/事件协议扩展）。
- 验证方式（如何自测/如何回滚）：用可复现的异常页面做 e2e；检查每一步工具调用的可观测输出；通过 feature flag 关闭 agent loop 回退到当前“一次性分析”模式。

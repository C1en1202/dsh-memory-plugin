# 长期记忆抽取器（Dynamic Cordis Plugin）

跨会话长期记忆：把对话中产生的**用户偏好、项目约定、经验教训**写入工作区根目录的 `MEMORY.md`，新会话通过检索自动"想起来"。文件是纯 Markdown，可以直接手工编辑整理。

- 插件代码：`code.host.js`（即 `cordis_define` 的 `code.host` 参数）
- 存储位置：工作区根目录 `MEMORY.md`
- 注册的工具：`memory_remember`（写入）、`memory_search`（检索，空 query = 全部列出）

## 运行步骤（在带 cordis 工具的会话里）

1. **打开一个挂载了 cordis 工具（cordis agent preset）的会话**，把 `code.host.js` 的完整内容发给它，说：
   > 用这个 code.host 定义一个动态插件并运行。先按 cordis 工作流验证 API，再 define，再 run。

2. **建议先做一次 API 验证**（让 cordis 代理执行，技能要求"先查真实接口"）：
   - `cordis_inspect_list` —— 看 Host 上注册了哪些 Provider；
   - `cordis_inspect_query` → `Service.listService`，`{ "service": "fs" }` —— 确认 `fs` 服务存在，方法为 `resolve` / `readText` / `writeText` / `stat`；
   - `cordis_inspect_query` → `Builtin.listBuiltins` —— 确认 `harness.defineTool` / `harness.registerTool`；
   - `cordis_inspect_query` → `Tool.listTools` —— 确认 `memory_remember` / `memory_search` 没有和现有工具重名。

3. **define + run**：cordis 代理会调用 `cordis_define`（新插件，`plugin.kind: 'new'`）再 `cordis_run`（模式 `run`）。纯 Host 包一般直接 `starting`，无需授权；如返回 `awaiting-approval` 再按提示批准。

4. **测试**：
   - 让代理 `memory_remember` 记一条：*"用户偏好：回复用中文，简洁"*；
   - 再 `memory_search` 查"中文"看能否命中；
   - 打开工作区根目录 `MEMORY.md` 确认内容。

5. **跨会话验证**：新开一个会话问"你还记得我有什么偏好吗"，正常代理会调用 `memory_search` 命中并回答。

## 设计要点（改代码时别破坏）

| 约束 | 说明 |
| --- | --- |
| 纯 JS，无 import/require/JSX/TS | 沙箱只暴露 `ctx` / `harness` / `console` / `btoa` / `atob` / `TextEncoder` / `TextDecoder` |
| `ctx.get('fs')` 判空 | fs 是可选服务，拿不到就静默退出；不要写成 `ctx.fs` 且不声明 `inject` |
| 工具参数 schema | `parameters` 用 `{ key: { type, description, required?, enum? } }`；`output.schema` 用 `{ type: 'json' }` 兜底任意 JSON |
| `render` 必须纯函数 | 只做展示，不读写文件；返回 `[{ type: 'text', text }]` |
| `execute` 返回 JSON | 参数/返回值必须 lossless JSON；用 try/catch 包住 fs 调用，失败返回 `{ ok: false, error }` 而不是抛错 |
| 生命周期 | `ctx.effect(() => harness.registerTool(ctx, def))` —— 插件 stop/update 时工具自动注销 |
| 日期 | `new Date()` 是 ECMAScript 内建，沙箱可用（`window/process/fetch/setTimeout` 不可用） |

## 升级路线

1. **自动抽取（v2）**：先 `cordis_inspect_query` → `Event.listEvents` 找到"消息产生"类事件的真实名称，再在 `apply` 里加 `ctx.on('<事件名>', (payload) => { ... })`，对每条新消息做关键词启发式（如出现"记住/偏好/以后都"），命中就自动调 `remember`。注意加去重，避免每条消息都写。
2. **固化（v3）**：验证好用后转成静态 npm 插件装进 profile：`dsh plugin --profile web add <pkg>`，并在 profile 的 `cordis.patch.yml` 里挂载，随 DSH 启动常驻。

## 已知边界

- 动态插件是**进程级**的：DSH 重启后需要重新 define/run（`MEMORY.md` 文件不受影响，新插件实例会继续读写它）。
- 记忆文件只有一份、全局共享：如果希望按项目/会话隔离，把 `FILE` 改成按 workspace 区分的路径即可。
- 检索是简单关键词匹配：条目多了以后可以升级成"抽取关键词 + 相关性排序"，或在 v3 用 SQLite/向量做正经检索。

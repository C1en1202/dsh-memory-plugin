# 长期记忆抽取器 v2（Dynamic Cordis Plugin）

跨会话长期记忆：把对话中产生的**用户偏好、项目约定、经验教训**写入工作区根目录的 `MEMORY.md`，新会话通过检索自动"想起来"。文件是纯 Markdown，可以直接手工编辑整理。

- 插件代码：`code.host.js`（即 `cordis_define` 的 `code.host` 参数）
- 存储位置：工作区根目录 `MEMORY.md`
- 工具：`memory_remember`（手动写入）、`memory_search`（检索，空 query = 全部列出）
- v2 增强：**自动抽取** —— 监听消息事件，命中触发词自动写入（带去重）

## v2 自动抽取（默认开启）

```js
const AUTO_EXTRACT = true   // false 可关闭，只保留手动工具
const MESSAGE_EVENT = 'message/send' // TODO: 必须替换为真实事件名！
const TRIGGERS = ['记住', '偏好', '习惯', '约定', '教训', '以后都', 'remember', 'preference', 'lesson']
```

- **先验证事件**：让 cordis 代理执行 `cordis_inspect_query` → `Event.listEvents`，找到"消息产生"类事件的确切名称和 payload 形状，替换 `MESSAGE_EVENT` 并按 payload 调整取文本逻辑（当前做了防御式兼容：字符串 / `text` / `content` / `content` 块数组）。
- 事件名不对时监听器不会触发（无害），但自动抽取不生效——**这是 v2 唯一需要你确认的地方**。
- 触发词命中后：去掉触发词前缀 → 清理开头标点 → 按内容自动归类（含"约定"→`convention`，含"教训"→`lesson`，否则 `fact`）→ 写入（相同类别+文本已存在则跳过）。
- 推荐把触发词和"只处理用户消息"的过滤按真实 payload 再调一轮，避免把助手消息也写进去。

## 运行步骤（在带 cordis 工具的会话里）

1. **打开一个挂载了 cordis 工具（cordis agent preset）的会话**，把 `code.host.js` 的完整内容发给它，说：
   > 用这个 code.host 定义一个动态插件并运行。先按 cordis 工作流验证 API（特别是 Event.listEvents 的消息事件名），再 define，再 run。

2. **建议先做一次 API 验证**（让 cordis 代理执行，技能要求"先查真实接口"）：
   - `cordis_inspect_list` —— 看 Host 上注册了哪些 Provider；
   - `cordis_inspect_query` → `Service.listService`，`{ "service": "fs" }` —— 确认 `fs` 服务存在，方法为 `resolve` / `readText` / `writeText` / `stat`；
   - `cordis_inspect_query` → `Builtin.listBuiltins` —— 确认 `harness.defineTool` / `harness.registerTool`；
   - `cordis_inspect_query` → `Event.listEvents` —— **拿到消息事件名，回填 `MESSAGE_EVENT`**；
   - `cordis_inspect_query` → `Tool.listTools` —— 确认 `memory_remember` / `memory_search` 没有和现有工具重名。

3. **define + run**：cordis 代理会调用 `cordis_define`（新插件，`plugin.kind: 'new'`）再 `cordis_run`（模式 `run`）。纯 Host 包一般直接 `starting`，无需授权；如返回 `awaiting-approval` 再按提示批准。

4. **测试**：
   - 手动：让代理 `memory_remember` 记一条：*"用户偏好：回复用中文，简洁"*；再 `memory_search` 查"中文"看能否命中；
   - 自动（事件名回填后）：直接说一句 *"记住，以后报告都用表格"*，随后打开 `MEMORY.md` 确认自动写入；
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
| 生命周期 | `ctx.effect(() => harness.registerTool(ctx, def))` / `ctx.effect(() => ctx.on(...))` —— 插件 stop/update 时自动注销 |
| 日期 | `new Date()` 是 ECMAScript 内建，沙箱可用（`window/process/fetch/setTimeout` 不可用） |

## 版本历史

- **v1**：手动记忆工具 `memory_remember` / `memory_search`。
- **v2**：自动抽取（事件监听 + 触发词启发式 + 去重）；`remember` 增加 dedupe 选项。

## 升级路线

1. **回填事件名**：v2 自动抽取的唯一待确认项（见上）。
2. **固化（v3）**：验证好用后转成静态 npm 插件装进 profile：`dsh plugin --profile web add <pkg>`，并在 profile 的 `cordis.patch.yml` 里挂载，随 DSH 启动常驻。
3. **检索升级**：条目多了以后可以把关键词匹配升级成"抽取关键词 + 相关性排序"，或在 v3 用 SQLite/向量做正经检索。

## 已知边界

- 动态插件是**进程级**的：DSH 重启后需要重新 define/run（`MEMORY.md` 文件不受影响，新插件实例会继续读写它）。
- 记忆文件只有一份、全局共享：如果希望按项目/会话隔离，把 `FILE` 改成按 workspace 区分的路径即可。
- 检索是简单关键词匹配：先搜索再决定是否升级。

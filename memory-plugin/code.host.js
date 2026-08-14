// 长期记忆抽取器 —— Dynamic Cordis Plugin 的 Host 半区（code.host）
// 说明：这个文件的内容就是 cordis_define 的 code.host 参数（函数体）。
// 纯 JS，不使用 import/require/JSX/TS。运行时沙箱只暴露 ctx / harness / console / btoa / atob / TextEncoder / TextDecoder。
// 记忆存储在工作区根目录的 MEMORY.md，跨会话、跨进程持久；插件本身是进程级的（重启后需重新 define/run）。
return {
  name: 'memory-extractor',

  apply(ctx) {
    // fs 是可选服务：拿不到就静默退出（记忆功能不可用，不影响其它插件）
    const fs = ctx.get('fs')
    if (fs === undefined) return

    const FILE = 'MEMORY.md'
    const HEADERS = { fact: 'Facts', convention: 'Conventions', lesson: 'Lessons' }
    const REV = { Facts: 'fact', Conventions: 'convention', Lessons: 'lesson' }

    // 确保记忆文件存在；返回已解析的 FsTarget
    async function ensureFile(signal) {
      const target = await fs.resolve(FILE, { signal })
      const info = await fs.stat(target, signal)
      if (info === undefined) {
        const seed = '# Long-term Memory\n\n## Facts\n\n## Conventions\n\n## Lessons\n'
        await fs.writeText(target, seed, undefined, signal)
      }
      return target
    }

    // 把 MEMORY.md 解析成 { category, date, text } 列表（保持文件顺序）
    function parseEntries(text) {
      const entries = []
      let category = null
      for (const raw of text.split('\n')) {
        const line = raw.trim()
        if (line.startsWith('## ')) {
          category = REV[line.slice(3)] || null
        } else if (category) {
          const m = /^-\s*\[([^\]]*)\]\s*(.+)$/.exec(line)
          if (m) entries.push({ category, date: m[1], text: m[2] })
        }
      }
      return entries
    }

    // 在对应 `## 类别` 段落后插入一条；保留用户手工编辑的其它内容
    function appendEntryText(text, category, entry) {
      const header = `## ${HEADERS[category]}`
      const line = `- [${entry.date}] ${entry.text}`
      const lines = text.split('\n')
      const idx = lines.findIndex((l) => l.trim() === header)
      if (idx === -1) {
        return `${text.replace(/\s+$/, '')}\n\n${header}\n\n${line}\n`
      }
      let at = idx + 1
      while (at < lines.length && lines[at].trim() === '') at++
      lines.splice(at, 0, line)
      return lines.join('\n')
    }

    // 写入一条记忆
    async function remember(category, rawText, signal) {
      const text = String(rawText || '').replace(/\s+/g, ' ').trim()
      if (!text) return { ok: false, error: 'text 为空' }
      const cat = HEADERS[category] ? category : 'fact'
      const target = await ensureFile(signal)
      const current = await fs.readText(target, signal)
      const date = new Date().toISOString().slice(0, 10)
      const next = appendEntryText(current, cat, { date, text })
      await fs.writeText(target, next, undefined, signal)
      const entries = parseEntries(next)
      return { ok: true, category: cat, text, total: entries.length }
    }

    // 检索记忆：query 为空 = 列出全部
    async function search(query, category, limit, signal) {
      const target = await ensureFile(signal)
      const current = await fs.readText(target, signal)
      const entries = parseEntries(current)
      const qs = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
      let matches = entries.filter((e) => {
        if (category && e.category !== category) return false
        if (qs.length === 0) return true
        const hay = (e.category + ' ' + e.text).toLowerCase()
        return qs.some((k) => hay.includes(k))
      })
      const cap = Math.max(1, Math.min(50, typeof limit === 'number' ? limit : 10))
      matches = matches.slice(0, cap)
      return { ok: true, total: entries.length, matches }
    }

    const rememberDef = harness.defineTool({
      name: 'memory_remember',
      description:
        '把一条值得跨会话保留的信息写入长期记忆（工作区 MEMORY.md）：用户偏好、项目约定、踩过的坑、关键决策。当前对话得出结论或发现持久事实时调用。',
      parameters: {
        category: {
          type: 'string',
          enum: ['fact', 'convention', 'lesson'],
          description: '类别：fact=事实/偏好，convention=项目约定，lesson=经验教训。默认 fact。',
        },
        text: { type: 'string', description: '要记住的内容，一句话', required: true },
      },
      output: {
        schema: { type: 'json' },
        render(args, value) {
          if (value.ok) {
            return [{ type: 'text', text: `已记住（${value.category}，共 ${value.total} 条）：${value.text}` }]
          }
          return [{ type: 'text', text: `记忆写入失败：${value.error}` }]
        },
      },
      async execute(args, exec) {
        try {
          return await remember(args.category, args.text, exec.signal)
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
    })

    const searchDef = harness.defineTool({
      name: 'memory_search',
      description:
        '检索长期记忆（工作区 MEMORY.md）。query 为空时列出全部条目。开始新任务、需要用户偏好或项目约定时优先调用。',
      parameters: {
        query: { type: 'string', description: '关键词，多个词用空格分隔（任一命中即返回）' },
        category: {
          type: 'string',
          enum: ['fact', 'convention', 'lesson'],
          description: '限定类别；省略则搜全部',
        },
        limit: { type: 'integer', description: '最多返回条数，默认 10，最大 50' },
      },
      output: {
        schema: { type: 'json' },
        render(args, value) {
          if (!value.ok) return [{ type: 'text', text: `记忆检索失败：${value.error}` }]
          if (value.matches.length === 0) {
            return [{ type: 'text', text: `没有匹配的记忆（共 ${value.total} 条）。` }]
          }
          const lines = value.matches.map((e) => `- [${e.category}] (${e.date}) ${e.text}`)
          lines.unshift(`命中 ${value.matches.length}/${value.total} 条记忆：`)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      async execute(args, exec) {
        try {
          return await search(args.query, args.category, args.limit, exec.signal)
        } catch (err) {
          return { ok: false, error: String((err && err.message) || err) }
        }
      },
    })

    // 注册属于本插件 Fiber 的动态工具；插件停止/更新时自动注销
    ctx.effect(() => harness.registerTool(ctx, rememberDef))
    ctx.effect(() => harness.registerTool(ctx, searchDef))
  },
}

// Local-machine collector: tracks per-session activity from events and builds
// a bounded, scalar-only snapshot. Services are read lazily (ctx.get at call
// time) so a missing service just leaves its block empty.
const text = (v) => (typeof v === 'string' ? v : '')
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0)
const MAX_SESSIONS = 200
const MAX_JOBS = 100

export function createCollector(ctx, machine) {
  const live = new Map() // sessionId -> activity
  const approvals = new Map()
  const questions = new Map()
  const running = new Map()

  const act = (id) => {
    let a = live.get(id)
    if (!a) {
      if (live.size >= MAX_SESSIONS * 2) return null
      a = { turn: 0, tin: 0, tout: 0, tools: 0, currentTool: '', lastEvent: 0, lastTool: '' }
      live.set(id, a)
    }
    return a
  }
  const guard = (fn) => (...args) => { try { return fn(...args) } catch { /* observing must never break DSH */ } }

  ctx.on('session/event', guard((session, event) => {
    const a = act(String(session.id))
    if (!a || !event) return
    a.lastEvent = num(event.time) || Date.now()
    const d = event.data || {}
    switch (event.type) {
      case 'turn/start': a.turn = num(d.turn); break
      case 'tool/call': a.currentTool = text(d.name).slice(0, 60); a.lastTool = a.currentTool; a.tools++; break
      case 'tool/result': a.currentTool = ''; break
      case 'turn/end': a.currentTool = ''; break
      case 'assistant/message':
        if (d.usage) { a.tin += num(d.usage.inputTokens); a.tout += num(d.usage.outputTokens) }
        break
    }
  }))
  ctx.on('session/disposed', guard((session) => { live.delete(String(session.id)); running.delete(String(session.id)) }))
  ctx.on('agent/status', guard((p) => { if (p && p.agent) running.set(String(p.agent.id), p.status === 'running') }))

  ctx.on('approval/request', async (req, next) => {
    let key = ''
    try {
      key = 'a:' + text(req && req.callId) + Math.random().toString(36).slice(2, 6)
      approvals.set(key, { kind: 'approval', session: req && req.agent ? String(req.agent.id) : '', title: text(req && req.toolName) || 'tool', detail: text(req && req.reason).slice(0, 200), at: Date.now() })
    } catch { /* ignore */ }
    try { return await next() } finally { if (key) approvals.delete(key) }
  })
  ctx.on('user-questions/request', async (request, next) => {
    let key = ''
    try {
      const first = (request && Array.isArray(request.questions) && request.questions[0]) || {}
      key = 'q:' + Math.random().toString(36).slice(2, 8)
      questions.set(key, { kind: 'question', session: request && request.agent ? String(request.agent.id) : '', title: text(first.header) || 'question', detail: text(first.question).slice(0, 200), at: Date.now() })
    } catch { /* ignore */ }
    try { return await next() } finally { if (key) questions.delete(key) }
  })

  const safe = (fn, fb) => { try { return fn() } catch { return fb } }

  function snapshot() {
    const sessionsSvc = ctx.get('sessions')
    const agentsSvc = ctx.get('agents')
    const jobsSvc = ctx.get('jobs')
    const titlesSvc = ctx.get('sessionTitle')
    const goalsSvc = ctx.get('goals')
    const agents = (agentsSvc && safe(() => agentsSvc.list(), [])) || []
    const agentById = new Map(agents.map((a) => [String(a.id), a]))

    const jobs = []
    const activeByOwner = new Map()
    if (jobsSvc) {
      const seen = new Set()
      const add = (j) => {
        const id = String(j.id)
        if (seen.has(id) || jobs.length >= MAX_JOBS) return
        seen.add(id)
        const owner = j.ownerSession ? String(j.ownerSession) : ''
        const status = text(j.status)
        const active = status === 'running' || status === 'stopping'
        if (owner && active) activeByOwner.set(owner, (activeByOwner.get(owner) || 0) + 1)
        jobs.push({ id, owner, status, kind: text(j.kind), label: text(j.label).split(/\r?\n/)[0].slice(0, 120), startedAt: num(j.startedAt) })
      }
      ;(safe(() => jobsSvc.list(), []) || []).forEach((j) => safe(() => add(j)))
      agents.forEach((a) => (safe(() => jobsSvc.list(a), []) || []).forEach((j) => safe(() => add(j))))
    }

    const sessions = []
    for (const s of (sessionsSvc && safe(() => sessionsSvc.list(), [])) || []) {
      if (sessions.length >= MAX_SESSIONS) break
      safe(() => {
        const id = String(s.id)
        const h = s.header || {}
        const a = live.get(id) || {}
        const agent = agentById.get(id)
        let title = ''
        if (titlesSvc) { const t = safe(() => titlesSvc.get(s), null); if (t) title = text(t.title) }
        let goal = null
        if (goalsSvc && agent) {
          const g = safe(() => goalsSvc.get(agent), null)
          if (g) goal = { phase: text(g.phase), rounds: num(g.roundsStarted), max: num(g.maxGoalRounds), objective: text(g.objective).slice(0, 160) }
        }
        sessions.push({
          id, title: title.slice(0, 120), running: running.get(id) === true,
          cwd: text(h.cwd), preset: text(h.agentPreset), parent: h.parentSession ? String(h.parentSession) : '',
          subagent: h.origin === 'subagent', createdAt: num(h.createdAt),
          lastActivity: num(a.lastEvent) || num(h.createdAt), turn: num(a.turn),
          tokens: { in: num(a.tin), out: num(a.tout) }, toolCalls: num(a.tools),
          currentTool: text(a.currentTool), activeJobs: activeByOwner.get(id) || 0, goal,
        })
      })
    }
    sessions.sort((x, y) => y.lastActivity - x.lastActivity)
    const pending = [...approvals.values(), ...questions.values()].sort((x, y) => x.at - y.at)
    return {
      machine, generatedAt: Date.now(), sessions, jobs, pending,
      totals: { sessions: sessions.length, running: sessions.filter((x) => x.running).length, jobsRunning: jobs.filter((j) => j.status === 'running' || j.status === 'stopping').length, pending: pending.length },
    }
  }
  return { snapshot }
}

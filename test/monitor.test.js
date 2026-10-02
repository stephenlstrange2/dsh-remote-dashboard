import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startMonitor, normalizeConfig, describeBindFailure } from '../lib/server.js'
import { createCollector } from '../lib/collect.js'

const snap = (machine, running = 1) => ({ machine, generatedAt: Date.now(), sessions: [], jobs: [], pending: [], totals: { sessions: 1, running, jobsRunning: 0, pending: 0 } })

test('config rejects unsafe exposure', () => {
  assert.throws(() => normalizeConfig({ mode: 'agent', host: '0.0.0.0' }), /allowRemote/)
  assert.throws(() => normalizeConfig({ mode: 'agent', host: '0.0.0.0', allowRemote: true, token: 'short' }), /token/)
  assert.throws(() => normalizeConfig({ mode: 'hub', host: '0.0.0.0', allowRemote: true }), /viewerKey/)
  assert.throws(() => normalizeConfig({ mode: 'x' }), /mode/)
  assert.throws(() => normalizeConfig({ mode: 'hub', peers: [{ name: 'a', url: 'ftp://x' }] }), /peer/)
  normalizeConfig({ mode: 'agent', host: '0.0.0.0', allowRemote: true, token: 'x'.repeat(16) })
  normalizeConfig({ mode: 'both', host: '0.0.0.0', allowRemote: true, viewerKey: 'viewer-key-1' }) // hub needs no agent token
})

test('agent requires bearer token; hub aggregates and flags offline peers', async () => {
  const token = 'secret-token-1234567'
  const agent = startMonitor({ mode: 'agent', port: 0, token }, { getLocalSnapshot: () => snap('A') })
  const aAddr = await agent.ready
  const base = `http://127.0.0.1:${aAddr.port}`
  assert.equal((await fetch(base + '/v1/snapshot')).status, 401)
  assert.equal((await fetch(base + '/v1/snapshot', { headers: { authorization: 'Bearer wrong-wrong-wrong' } })).status, 401)
  assert.equal((await fetch(base + '/v1/snapshot', { headers: { authorization: 'Bearer ' + token } })).status, 200)
  assert.equal((await fetch(base + '/', {})).status, 404, 'agent mode serves no page')
  assert.equal((await fetch(base + '/v1/snapshot', { method: 'POST' })).status, 405)

  const hub = startMonitor({
    mode: 'both', machine: 'hub', port: 0, pollMs: 1000, viewerKey: 'viewer-key-1',
    peers: [{ name: 'A', url: base, token }, { name: 'dead', url: 'http://127.0.0.1:1', token: 'x' }],
  }, { getLocalSnapshot: () => snap('hub', 0) })
  const hAddr = await hub.ready
  const hb = `http://127.0.0.1:${hAddr.port}`
  await new Promise((r) => setTimeout(r, 600))

  assert.equal((await fetch(hb + '/api/fleet')).status, 401)
  assert.equal((await fetch(hb + '/')).status, 401)
  const bad = await fetch(hb + '/?key=nope', { redirect: 'manual' })
  assert.equal(bad.status, 401)
  const ok = await fetch(hb + '/?key=viewer-key-1', { redirect: 'manual' })
  assert.equal(ok.status, 303)
  const cookie = ok.headers.get('set-cookie').split(';')[0]
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/)
  const page = await fetch(hb + '/', { headers: { cookie } })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /DSH Monitor/)

  const fleet = await (await fetch(hb + '/api/fleet', { headers: { authorization: 'Bearer viewer-key-1' } })).json()
  const by = Object.fromEntries(fleet.machines.map((m) => [m.name, m]))
  assert.equal(by.hub.online, true)
  assert.equal(by.A.online, true)
  assert.equal(by.A.snapshot.machine, 'A')
  assert.equal(by.dead.online, false)
  assert.ok(by.dead.error)
  assert.equal(JSON.stringify(fleet).includes(token), false, 'peer tokens never leak to the tablet')

  assert.equal((await fetch(hb + '/v1/snapshot')).status, 404, 'both-mode without token exposes no agent endpoint')
  await hub.close(); await agent.close()
})

test('collector tracks activity and survives hostile services', async () => {
  const handlers = {}
  const session = { id: 's1', header: { cwd: '/w/proj', createdAt: 1000, agentPreset: 'p' } }
  const ctx = {
    on: (n, fn) => { handlers[n] = fn },
    get: (n) => ({
      sessions: { list: () => [session] },
      agents: { list: () => [{ id: 's1' }] },
      sessionTitle: { get: () => { throw new Error('boom') } },
      jobs: { list: () => [{ id: 'j1', ownerSession: 's1', status: 'running', label: 'sleep 1\nline2' }] },
    }[n]),
  }
  const c = createCollector(ctx, 'M')
  handlers['agent/status']({ agent: { id: 's1' }, status: 'running' })
  handlers['session/event'](session, { type: 'turn/start', time: 5000, data: { turn: 3 } })
  handlers['session/event'](session, { type: 'tool/call', time: 5100, data: { name: 'bash' } })
  handlers['session/event'](session, { type: 'assistant/message', time: 5200, data: { usage: { inputTokens: 10, outputTokens: 4 } } })
  let s = c.snapshot()
  assert.equal(s.sessions[0].running, true)
  assert.equal(s.sessions[0].turn, 3)
  assert.equal(s.sessions[0].currentTool, 'bash')
  assert.deepEqual(s.sessions[0].tokens, { in: 10, out: 4 })
  assert.equal(s.sessions[0].activeJobs, 1)
  assert.equal(s.jobs[0].label, 'sleep 1')
  handlers['session/event'](session, { type: 'tool/result', time: 5300, data: {} })
  assert.equal(c.snapshot().sessions[0].currentTool, '')

  // approval waterfall passes next() through and clears the pending item
  let during
  const r = await handlers['approval/request']({ toolName: 'bash', agent: { id: 's1' } }, async () => { during = c.snapshot().pending.length; return 'allow' })
  assert.equal(r, 'allow'); assert.equal(during, 1); assert.equal(c.snapshot().pending.length, 0)
  handlers['session/event'](null, null) // must not throw
})

test('bind failures say what to do', async () => {
  const ifaces = { eth0: [{ family: 'IPv4', address: '172.31.1.2' }], lo: [{ family: 'IPv6', address: '::1' }] }
  const cfg = { host: '100.1.2.3', port: 3090 }
  const m = describeBindFailure(cfg, { code: 'EADDRNOTAVAIL' }, ifaces)
  assert.match(m, /100\.1\.2\.3:3090/); assert.match(m, /172\.31\.1\.2 \(eth0\)/); assert.match(m, /0\.0\.0\.0/)
  assert.match(describeBindFailure(cfg, { code: 'EADDRINUSE' }, ifaces), /already in use/)
  // real failure path: the server's ready promise rejects with a code we can explain
  const bad = startMonitor({ mode: 'agent', host: '127.0.0.1', port: 0 }, { getLocalSnapshot: () => ({}) })
  const a = await bad.ready
  const clash = startMonitor({ mode: 'agent', host: '127.0.0.1', port: a.port }, { getLocalSnapshot: () => ({}) })
  await assert.rejects(clash.ready, (e) => e.code === 'EADDRINUSE')
  await clash.close(); await bad.close()
})

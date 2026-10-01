// DSH-independent HTTP layer: agent endpoint + hub aggregator + page.
import { createServer } from 'node:http'
import { timingSafeEqual, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = () => readFileSync(join(HERE, 'page.html'), 'utf8')

const digest = (s) => createHash('sha256').update(String(s)).digest()
export const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && timingSafeEqual(digest(a), digest(b))

function parseCookies(h) {
  const out = {}
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}
const bearer = (req) => {
  const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''))
  return m ? m[1] : ''
}

export function normalizeConfig(c = {}) {
  const cfg = {
    mode: c.mode || 'agent',
    machine: c.machine || '',
    host: c.host || '127.0.0.1',
    port: Number.isInteger(c.port) ? c.port : 3090,
    token: c.token || '',
    viewerKey: c.viewerKey || '',
    peers: Array.isArray(c.peers) ? c.peers : [],
    pollMs: Math.max(1000, Number(c.pollMs) || 3000),
    allowRemote: c.allowRemote === true,
  }
  if (!['agent', 'hub', 'both'].includes(cfg.mode)) throw new Error('dsh-monitor: mode must be agent, hub or both')
  const serveAgent = cfg.mode === 'agent' || (cfg.mode === 'both' && cfg.token !== '')
  const serveHub = cfg.mode !== 'agent'
  const loopback = cfg.host === '127.0.0.1' || cfg.host === '::1' || cfg.host === 'localhost'
  if (!loopback && !cfg.allowRemote) throw new Error('dsh-monitor: binding a non-loopback host requires allowRemote: true')
  if (serveAgent && !loopback && cfg.token.length < 16) throw new Error('dsh-monitor: agent token (>=16 chars) is required on a non-loopback host')
  if (serveHub && !loopback && cfg.viewerKey.length < 8) throw new Error('dsh-monitor: viewerKey (>=8 chars) is required for the hub on a non-loopback host')
  for (const p of cfg.peers) {
    if (!p || !p.name || !/^https?:\/\//.test(p.url || '')) throw new Error('dsh-monitor: each peer needs name and http(s) url')
  }
  return cfg
}

export function startMonitor(rawCfg, { getLocalSnapshot, log = () => {} }) {
  const cfg = normalizeConfig(rawCfg)
  const serveAgent = cfg.mode === 'agent' || (cfg.mode === 'both' && cfg.token !== '')
  const serveHub = cfg.mode !== 'agent'
  const peers = cfg.peers.map((p) => ({ ...p, state: { snapshot: null, lastOk: 0, error: 'not polled yet', rttMs: 0 } }))
  let timer = null
  let polling = false

  async function pollOne(p) {
    const t0 = Date.now()
    try {
      const res = await fetch(p.url.replace(/\/+$/, '') + '/v1/snapshot', {
        headers: p.token ? { authorization: 'Bearer ' + p.token } : {},
        signal: AbortSignal.timeout(Math.min(8000, cfg.pollMs * 2)),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const snap = await res.json()
      p.state = { snapshot: snap, lastOk: Date.now(), error: '', rttMs: Date.now() - t0 }
    } catch (e) {
      p.state = { ...p.state, error: String((e && e.message) || e).slice(0, 160) }
    }
  }
  async function pollAll() {
    if (polling) return
    polling = true
    try { await Promise.all(peers.map(pollOne)) } finally { polling = false }
  }
  if (serveHub && peers.length) { void pollAll(); timer = setInterval(pollAll, cfg.pollMs); timer.unref?.() }

  function fleet() {
    const now = Date.now()
    const machines = []
    if (cfg.mode === 'both') {
      const s = getLocalSnapshot()
      machines.push({ name: cfg.machine || s.machine, online: true, local: true, ageMs: 0, rttMs: 0, error: '', snapshot: s })
    }
    for (const p of peers) {
      const st = p.state
      const age = st.lastOk ? now - st.lastOk : null
      machines.push({ name: p.name, online: st.lastOk > 0 && age < cfg.pollMs * 4, local: false, ageMs: age, rttMs: st.rttMs, error: st.error, snapshot: st.snapshot })
    }
    return { generatedAt: now, pollMs: cfg.pollMs, machines }
  }

  const send = (res, status, type, body, extra) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...(extra || {}) })
    res.end(body)
  }
  const json = (res, status, obj) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj))

  const viewerOk = (req, url) => {
    if (!cfg.viewerKey) return true // loopback-only configs may omit the key
    return safeEqual(bearer(req), cfg.viewerKey) || safeEqual(parseCookies(req.headers.cookie).dshmon || '', cfg.viewerKey)
  }

  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://x')
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed', { allow: 'GET, HEAD' })

      if (serveAgent && url.pathname === '/v1/snapshot') {
        if (cfg.token && !safeEqual(bearer(req), cfg.token)) return send(res, 401, 'text/plain', 'unauthorized', { 'www-authenticate': 'Bearer' })
        return json(res, 200, getLocalSnapshot())
      }
      if (serveHub) {
        if (url.pathname === '/' || url.pathname === '/index.html') {
          const key = url.searchParams.get('key')
          if (key !== null) { // exchange the one-time URL key for a cookie, then drop it from the URL
            if (cfg.viewerKey && safeEqual(key, cfg.viewerKey)) {
              return send(res, 303, 'text/plain', '', { location: './', 'set-cookie': 'dshmon=' + encodeURIComponent(key) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000' })
            }
            return send(res, 401, 'text/plain', 'bad key')
          }
          if (!viewerOk(req, url)) return send(res, 401, 'text/html; charset=utf-8', '<h3>DSH Monitor</h3><p>Open this page once with <code>?key=YOUR_VIEWER_KEY</code>.</p>')
          return send(res, 200, 'text/html; charset=utf-8', PAGE())
        }
        if (url.pathname === '/api/fleet') {
          if (!viewerOk(req, url)) return send(res, 401, 'text/plain', 'unauthorized')
          return json(res, 200, fleet())
        }
      }
      send(res, 404, 'text/plain', 'not found')
    } catch (e) {
      try { send(res, 500, 'text/plain', 'error') } catch { /* closed */ }
      log('request failed: ' + ((e && e.message) || e))
    }
  })

  const ready = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(cfg.port, cfg.host, () => resolve(server.address()))
  })
  const close = () => new Promise((resolve) => {
    if (timer) clearInterval(timer)
    server.close(() => resolve())
    server.closeAllConnections?.()
  })
  return { ready, close, fleet, server, cfg }
}

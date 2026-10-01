# DSH Monitor: research notes (2026-10-01)

Goal: a spare tablet that shows my DSH sessions live, as a dashboard or kiosk, without opening the whole GUI.

## 1. What I already have installed (`~/.dsh/profiles/web`)

| Plugin | Relevance |
|---|---|
| **dsh-mobile 0.5.2** (saya-ch, ★343) | Already set up: an HTTPS LAN gateway on `wlp2s0:3443` that proxies to `127.0.0.1:3080`, with device pairing, a private CA, and an Android app. It proxies the **full GUI**, so any route a plugin registers on `webServer` can also be reached through it after pairing. |
| dshmarket | Plugin market UI. |

## 2. What's out there (awesome-dsh-plugin registry, 4,400 entries)

Closest to "tablet monitor":

| Plugin | What it is | Notes |
|---|---|---|
| **dsh-taskwatch** (npm, v1.0.2) | Read-only monitor: a `/taskwatch` HTML page plus `/taskwatch/data` JSON. Shows sessions, jobs, subagents, goals, workflows, and pending approvals. Polls every 3 s with ETag/304 and ships a PWA. | **Best reference implementation.** Pure JS, ~60 KB. Downloaded to `.research/dsh-taskwatch`. Phone-portrait UI in Chinese. **Its routes have no auth.** |
| dsh-prometheus | Prometheus metrics plus a Grafana dashboard. | Overkill for one tablet, but a good fit if you already run Grafana. |
| dsh-api / dsh-webapi / dsh-api-gateway | REST + SSE wrappers over DSH internals. | Useful as a backend for a custom app. |
| dsh-palm, dsh-plugin-mobile-bridge | Mobile surfaces with SSE, push notifications, and approvals. | Heavier, full remote control. |
| dsh-foxbell-pet, dsh-answer-pet, dsh-codex-pet | "Status lights for every active session" widgets. | UI ideas only. |
| dsh-progress-viz | Live grid of headless task stages. | Idea source. |

None of these is a **landscape, glanceable, multi-session wall dashboard for a tablet**. That gap is our project.

## 3. How a DSH plugin can do this

Host side (a Cordis plugin, plain ESM JS, no build needed):

```js
export const name = 'dsh-monitor'
export const inject = ['webServer']          // hard dependency; without it, routes silently 404
export function apply(ctx) {
  const agents = ctx.get('agents'), sessions = ctx.get('sessions'),
        jobs = ctx.get('jobs'), goals = ctx.get('goals'),
        subagents = ctx.get('subagents'), titles = ctx.get('sessionTitle')
  ctx.on('agent/status', p => ...)            // running/idle
  ctx.on('api-session/status', (id, running) => ...)
  ctx.on('approval/request', async (req, next) => { track; return next() })   // waterfall: must pass through
  ctx.on('user-questions/request', ...)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/monitor', handler }))
}
```

- Packaging: `package.json` → `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, with a patch that `insert`s the plugin. Install with `dsh plugin --profile web add <path|npm>`.
- Live updates: SSE from a `webServer` prefix route, or a WebSocket through `registerUpgrade`. The simplest robust option is polling with ETag, which is what taskwatch does.
- Cold, persisted sessions: `ctx.sessionQuery.listSessions()` (exists on the Host) and the `sessionStats` projection for turns, steps, and LLM/tool time.

### Auth / exposure options

| Option | How | Trade-off |
|---|---|---|
| A. Through dsh-mobile (recommended) | Register `/monitor` on `webServer`, then open `https://<pc-lan-ip>:3443/monitor` on the paired tablet. | Pairing, TLS, and device revocation come free, and the route itself stays loopback-only. Needs a one-time pairing on the tablet. |
| B. Own LAN listener + token | The plugin opens its own `0.0.0.0:<port>` HTTP server serving **read-only** JSON plus a shared secret. | Independent of dsh-mobile and works on any old tablet browser. Our own security (read-only reduces the risk). |
| C. `ctx.connection.fetch` exact routes | Authenticated with the GUI browser cookie. | Needs the GUI token exchange on the tablet. Clunky. |

## 4. Multi-machine requirement (added)

Existing multi-host plugins: dsh-fleet (iframes of full GUIs, controller/managed split), dsh-remote-dsh
(sidebar row per host), dsh-sev / dsh-multi-end (SSH tunnels), dsh-alpha / dsh-weave (orchestration / mesh).
None is a read-only, glanceable multi-machine wall dashboard.

Consequences:
- **dsh-mobile doesn't scale here.** Pairing is per origin and cookie-based, so one page can't
  aggregate several dsh-mobile origins (cross-origin cookies/CORS). → Option B (own read-only listener + bearer token).
- **Architecture: agent + hub.**
  - *Agent* (DSH plugin, on every machine): `GET /v1/snapshot` (ETag) + `GET /v1/events` (SSE), read-only,
    bearer token, own listener (e.g. `0.0.0.0:3090` or Tailscale IP only).
  - *Hub* (one place): polls/subscribes to all agents, merges, marks unreachable hosts, serves the
    tablet page. Can run as the same plugin in `hub` mode, or as a standalone `node hub.mjs` (keeps
    working when that DSH restarts). Tokens stay on the hub, not the tablet.
  - *Tablet*: one URL → hub. Landscape grid grouped by machine.
- Machines in different places → Tailscale recommended (encrypted, no port forwarding).

### Client options

1. **Static HTML + fetch/SSE served by the plugin.** Zero install: "Add to home screen" as a PWA, with fullscreen kiosk via Fully Kiosk Browser (Android). **Recommended.**
2. Native app. Not worth it: the PWA covers fullscreen, wake-lock (`navigator.wakeLock`), and offline shell.

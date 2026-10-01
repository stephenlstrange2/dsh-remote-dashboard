# dsh-monitor

Read-only, multi-machine session monitor for DeepSeek Harness, built for a wall/tablet screen.

```
 machine A (DSH)  ──┐   agent  GET /v1/snapshot  (Bearer token)
 machine B (DSH)  ──┼──────────────►  HUB (one DSH)  ──►  tablet browser  http://hub:3090/?key=VIEWER_KEY
 machine C (DSH)  ──┘   polled every pollMs        serves the page + /api/fleet
```

No dependencies, no build step. Nothing here can write to DSH: the server only answers `GET`/`HEAD`.

## Modes
| mode | serves | use |
|---|---|---|
| `agent` | `/v1/snapshot` (token) | every machine you want to watch |
| `hub` | the tablet page + `/api/fleet` | a machine that only aggregates |
| `both` | everything, plus this machine's own sessions | the machine hosting the dashboard |

Peer tokens stay on the hub. The tablet only holds the viewer key, which becomes an HttpOnly cookie on first visit.

## Install
```sh
dsh plugin --profile web add /path/to/DSH-Dashboard
```
Then add config to the profile's `cordis.patch.yml` (a top-level YAML list).

**Each watched machine (agent)**, reachable over Tailscale or LAN:
```yaml
- id: dsh-monitor
  config:
    mode: agent
    machine: lab-pc
    host: 100.64.0.10        # this machine's Tailscale/LAN IP, never a public one
    allowRemote: true        # required for any non-loopback host
    port: 3090
    token: <random 16+ chars>
```

**The hub machine:**
```yaml
- id: dsh-monitor
  config:
    mode: both
    machine: hub-pc
    host: 0.0.0.0            # or its LAN/Tailscale IP
    allowRemote: true
    port: 3090
    viewerKey: <random 8+ chars>
    pollMs: 3000
    peers:
      - { name: lab-pc,   url: 'http://100.64.0.10:3090', token: <that agent's token> }
      - { name: home-nuc, url: 'http://100.64.0.11:3090', token: <...> }
```
Open `http://<hub>:3090/?key=<viewerKey>` on the tablet once, then add it to the home screen.
Generate secrets with `openssl rand -hex 16`.

## Safety
- Non-loopback binds are refused unless `allowRemote: true`, and then a token (agent) or viewerKey (hub) is mandatory.
- Constant-time comparison; peer tokens never reach the browser.
- No TLS: keep this on Tailscale or a trusted LAN. Don't port-forward it.
- Snapshots contain session titles, working directories, tool names and approval text. Treat the viewer key like a password.

## What the page shows
Per machine: online state and round-trip time (or time since last contact when offline), running count. Per session: running LED, title, time since last activity, the tool executing now, working-directory name, turn, tokens in/out, active background jobs, goal progress. Pending approvals and questions from any machine appear in a banner and in the tab title.

## Limits
- Live metrics (turn, tokens, current tool) count events seen since the plugin started.
- Sessions that exist only on disk and aren't loaded are not listed.
- The page uses plain ES5 for old tablet browsers. Keep-awake needs HTTPS or localhost, so on plain HTTP set the tablet's screen timeout to "never" or use a kiosk browser.

## Development
`npm test` covers config validation, auth, hub aggregation, offline detection and the collector.

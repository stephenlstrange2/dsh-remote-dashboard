// dsh-monitor — DSH plugin entry. Hot path never throws into DSH.
import { createCollector } from './collect.js'
import { startMonitor, describeBindFailure } from './server.js'

export const name = 'dsh-monitor'
// Services are read lazily at snapshot time; none is a hard dependency.

export async function apply(ctx, config = {}) {
  const machine = config.machine || process.env.DSH_MONITOR_MACHINE || (await import('node:os')).hostname()
  const collector = createCollector(ctx, machine)
  const mon = startMonitor({ ...config, machine }, {
    getLocalSnapshot: () => collector.snapshot(),
    log: (m) => ctx.logger.warn('dsh-monitor: ' + m),
  })
  try {
    const addr = await mon.ready
    ctx.logger.info(`dsh-monitor: mode=${mon.cfg.mode} listening on ${addr.address}:${addr.port} as "${machine}"`)
  } catch (e) {
    ctx.logger.warn('dsh-monitor: NOT RUNNING - ' + describeBindFailure(mon.cfg, e))
    void mon.close()
    return
  }
  ctx.effect(() => () => { void mon.close() })
}

export default { name, apply }

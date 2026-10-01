import { Config, validateConfig } from './config.js';
import { installEndpoint } from './endpoint.js';
import { HarnessMetrics } from './metrics.js';
export { Config };
export { CardinalityGuard, OVERFLOW_VALUE } from './cardinality.js';
export { HarnessMetrics } from './metrics.js';
export const name = 'prometheus';
export const inject = ['sessions', 'agents', 'llm', 'tools', 'subagents', 'jobs'];
/** Install the collectors and the selected HTTP adapter as one Cordis fiber. */
export async function apply(ctx, config) {
    if (!config.enabled)
        return;
    validateConfig(config);
    const reportedFaults = new Set();
    const metrics = new HarnessMetrics(config, (operation) => {
        if (reportedFaults.has(operation))
            return;
        reportedFaults.add(operation);
        ctx.logger.warn(`dsh-prometheus: contained metric update failure in ${operation}`);
    });
    ctx.effect(() => () => { metrics.dispose(); });
    metrics.seedSessions(ctx.sessions.list().length);
    ctx.on('session/created', () => { metrics.sessionCreated(); });
    ctx.on('session/disposed', session => { metrics.sessionDisposed(session); });
    ctx.on('session/event', (session, event) => { metrics.sessionEvent(session, event); });
    ctx.on('agent/error', () => { metrics.agentError(); });
    ctx.on('llm/stream', (options, next) => metrics.llmStream(options, next));
    ctx.on('tools/execute', (execution, next) => metrics.toolExecution(execution, next));
    ctx.on('subagent/start', info => { metrics.subagentStarted(info); });
    ctx.on('subagent/end', info => { metrics.subagentEnded(info); });
    const allJobs = initialJobs(ctx);
    metrics.seedJobs(allJobs);
    ctx.effect(() => ctx.jobs.onJobsChanged((owner) => {
        try {
            metrics.reconcileJobs(ctx.jobs.list(owner), owner === undefined ? undefined : String(owner.session.id));
        }
        catch {
            if (!reportedFaults.has('jobs-changed')) {
                reportedFaults.add('jobs-changed');
                ctx.logger.warn('dsh-prometheus: contained jobs reconciliation failure');
            }
        }
    }));
    ctx.effect(() => ctx.jobs.onJobDone((snapshot) => { metrics.jobDone(snapshot); }));
    const endpoint = await installEndpoint(ctx, config, metrics.registry);
    if (endpoint.mode === 'webserver') {
        ctx.logger.info(`dsh-prometheus: metrics route active at ${endpoint.path}`);
    }
    else {
        ctx.logger.info(`dsh-prometheus: metrics endpoint active at http://${endpoint.host}:${endpoint.port}${endpoint.path}`);
    }
}
function initialJobs(ctx) {
    const snapshots = new Map();
    const add = (rows) => {
        for (const row of rows)
            snapshots.set(String(row.id), row);
    };
    add(ctx.jobs.list());
    for (const agent of ctx.agents.list())
        addJobsForAgent(ctx, agent, add);
    return [...snapshots.values()];
}
function addJobsForAgent(ctx, agent, add) {
    add(ctx.jobs.list(agent));
}
export default { name, inject, Config, apply };
//# sourceMappingURL=index.js.map
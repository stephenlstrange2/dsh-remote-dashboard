import type { Context } from '@deepseek-ai/cordis';
import { Config, type Config as PrometheusConfig } from './config.js';
import { type ActiveEndpoint } from './endpoint.js';
export { Config };
export type { ActiveEndpoint, PrometheusConfig };
export { CardinalityGuard, OVERFLOW_VALUE } from './cardinality.js';
export { HarnessMetrics } from './metrics.js';
export declare const name = "prometheus";
export declare const inject: string[];
/** Install the collectors and the selected HTTP adapter as one Cordis fiber. */
export declare function apply(ctx: Context, config: PrometheusConfig): Promise<void>;
declare const _default: {
    name: string;
    inject: string[];
    Config: import("@deepseek-ai/schemastery").default<Config>;
    apply: typeof apply;
};
export default _default;
//# sourceMappingURL=index.d.ts.map
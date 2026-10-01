import type { Context } from '@deepseek-ai/cordis';
import type { Registry } from 'prom-client';
import type { Config } from './config.js';
export type ActiveEndpoint = {
    readonly mode: 'webserver';
    readonly path: string;
} | {
    readonly mode: 'standalone';
    readonly host: string;
    readonly port: number;
    readonly path: string;
};
/** Select and install exactly one lifecycle-owned scrape endpoint. */
export declare function installEndpoint(ctx: Context, config: Config, registry: Registry): Promise<ActiveEndpoint>;
//# sourceMappingURL=endpoint.d.ts.map
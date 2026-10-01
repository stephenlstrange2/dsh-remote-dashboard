import z from '@deepseek-ai/schemastery';
export type EndpointMode = 'auto' | 'webserver' | 'standalone';
export interface Config {
    /** Disable every listener and endpoint without removing the bundle row. */
    enabled: boolean;
    /** Prefer a public DSH WebServer route, require it, or always own a socket. */
    mode: EndpointMode;
    /** Standalone listener host. Remote binding also requires allowRemote. */
    host: '127.0.0.1' | '0.0.0.0';
    /** Standalone listener port. Zero requests an ephemeral test/development port. */
    port: number;
    /** Exact HTTP pathname used by either endpoint adapter. */
    path: string;
    /** Explicit acknowledgement that the endpoint may be remotely reachable. */
    allowRemote: boolean;
    /** Maximum accepted dynamic values for each label key. */
    maxLabelValues: number;
    /** Maximum length of one accepted dynamic label value. */
    maxLabelValueLength: number;
}
export declare const Config: z<Config>;
/** Cross-field and pathname checks that Schemastery does not express. */
export declare function validateConfig(config: Config): void;
//# sourceMappingURL=config.d.ts.map
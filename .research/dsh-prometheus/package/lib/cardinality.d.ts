export declare const OVERFLOW_VALUE = "__other__";
export interface CardinalityOptions {
    maxValues: number;
    maxValueLength: number;
    onOverflow(label: DynamicLabel): void;
}
export type DynamicLabel = 'provider' | 'model' | 'tool' | 'kind';
/**
 * Bounds metric series before values reach prom-client. Rejected values are
 * never logged, hashed, exported, or retained.
 */
export declare class CardinalityGuard {
    private readonly options;
    private readonly values;
    constructor(options: CardinalityOptions);
    value(label: DynamicLabel, raw: string): string;
    clear(): void;
}
//# sourceMappingURL=cardinality.d.ts.map
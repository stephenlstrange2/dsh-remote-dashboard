export const OVERFLOW_VALUE = '__other__';
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/;
/**
 * Bounds metric series before values reach prom-client. Rejected values are
 * never logged, hashed, exported, or retained.
 */
export class CardinalityGuard {
    options;
    values = new Map();
    constructor(options) {
        this.options = options;
    }
    value(label, raw) {
        if (raw.length === 0
            || raw.length > this.options.maxValueLength
            || !SAFE_IDENTIFIER.test(raw)) {
            this.options.onOverflow(label);
            return OVERFLOW_VALUE;
        }
        let accepted = this.values.get(label);
        if (accepted === undefined) {
            accepted = new Set();
            this.values.set(label, accepted);
        }
        if (accepted.has(raw))
            return raw;
        if (accepted.size >= this.options.maxValues) {
            this.options.onOverflow(label);
            return OVERFLOW_VALUE;
        }
        accepted.add(raw);
        return raw;
    }
    clear() {
        this.values.clear();
    }
}
//# sourceMappingURL=cardinality.js.map
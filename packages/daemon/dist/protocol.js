/** JSON-over-newline protocol for SDK ↔ Daemon communication. */
const REQUIRED_FIELDS = {
    run_start: ['runId', 'agentId'],
    run_end: ['runId', 'status', 'totalCost'],
    step_start: ['runId', 'stepId', 'stepNumber', 'toolName', 'argsHash'],
    step_end: ['runId', 'stepId', 'costUsd', 'tokensIn', 'tokensOut', 'latencyMs'],
    guard_event: ['runId', 'eventType', 'severity'],
};
const KNOWN_TYPES = new Set(Object.keys(REQUIRED_FIELDS));
/**
 * Parse a raw JSON string into a typed SDKMessage.
 *
 * @param raw - A single line of JSON (without trailing newline).
 * @throws Error if the JSON is invalid or required fields are missing.
 */
export function parseMessage(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`Protocol: malformed JSON — ${err.message}`);
    }
    const type = parsed['type'];
    if (!KNOWN_TYPES.has(type)) {
        throw new Error(`Protocol: unknown message type '${type}'`);
    }
    const required = REQUIRED_FIELDS[type];
    const missing = required.filter((f) => !(f in parsed));
    if (missing.length > 0) {
        throw new Error(`Protocol: message type '${type}' missing required fields: ${missing.join(', ')}`);
    }
    return parsed;
}
/**
 * Serialise a DaemonResponse to a single-line JSON string with trailing newline.
 *
 * @param response - The response to serialise.
 * @returns JSON string terminated with '\n'.
 */
export function serialiseResponse(response) {
    return JSON.stringify(response) + '\n';
}
/** Convenience factory for a proceed response. */
export const PROCEED = { type: 'proceed' };
//# sourceMappingURL=protocol.js.map
/** MCP / JSON-RPC 2.0 protocol types for the Fuze proxy. */
// ── Type guards ───────────────────────────────────────────────────────────────
export function isRequest(msg) {
    return 'id' in msg && 'method' in msg;
}
export function isResponse(msg) {
    return 'id' in msg && !('method' in msg);
}
export function isToolCall(msg) {
    return isRequest(msg) && msg.method === 'tools/call';
}
//# sourceMappingURL=types.js.map
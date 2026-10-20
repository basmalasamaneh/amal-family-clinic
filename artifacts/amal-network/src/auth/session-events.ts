type Handler = () => void;
let handler: Handler | null = null;
/** Single subscriber (ShellRoot) for 401s from any query/mutation; avoids repeated auth retries. */
export function onUnauthorized(h: Handler): () => void { handler = h; return () => { if (handler === h) handler = null; }; }
export function reportUnauthorized(): void { handler?.(); }

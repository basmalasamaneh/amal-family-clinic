/** Public shell documents only. This is not an authorization or API routing policy. */
export function isAppDocument(request: Pick<Request, 'mode' | 'destination'>, url: URL, base: URL): boolean {
  if (request.mode !== 'navigate' || request.destination !== 'document' || url.origin !== base.origin) return false;
  if (!url.pathname.startsWith(base.pathname)) return false;
  const path = url.pathname.slice(base.pathname.length).replace(/\/+$/, '');
  // Explicitly exclude integration surfaces at every segment (including nested app mounts).
  if (/(?:^|\/)(?:api|auth|docs|__mockup|canvas)(?:\/|$)/i.test(path)) return false;
  return /^(?:|login|data|ui-kit|(?:desk|doctor|admin)\/[a-z-]+)$/.test(path);
}

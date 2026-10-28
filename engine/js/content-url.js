export function resolveContentUrl(workRoot, path, baseUrl = globalThis.document?.baseURI) {
  const relative = `${workRoot}${path}`;
  if (!baseUrl) return relative;
  const root = new URL(workRoot, baseUrl);
  const resolved = new URL(path, root);
  if (!resolved.href.startsWith(root.href)) throw new Error(`content path escapes work root: ${path}`);
  return resolved.href;
}

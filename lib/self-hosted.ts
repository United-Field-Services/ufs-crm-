const PLATFORM_IDENTITY_PREFIX = 'oai-authenticated-user-';

// OpenAI Sites sets these headers after its own sign-in. On any other host (for example a plain
// Cloudflare Worker) they come straight from the visitor and must never be believed.
export function stripPlatformIdentity(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith(PLATFORM_IDENTITY_PREFIX)) headers.delete(name);
  }
  return new Request(request, { headers });
}

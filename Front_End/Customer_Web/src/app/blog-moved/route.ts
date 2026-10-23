/**
 * BHA-BLOG-001-CP04: where the middleware sends an old Blog address (an old slug, an old category, `/blog?category=`) to be answered with the PERMANENT redirect.
 * Next 13.4's middleware cannot make a usable 301 behind a TLS terminator (it sees `http:`, and its adapter refuses a relative Location), but a route handler can send
 * a relative `Location`, which the browser resolves against the address it actually used — so the scheme and host it typed are kept. Only the middleware asks for this
 * path, but anyone can: the target is accepted only in the exact shape of a Blog address of this site, so it can never send a reader anywhere else.
 */
const BLOG_TARGET = /^\/blog(?:\/category)?\/[a-z0-9]+(?:-[a-z0-9]+)*\?locale=[a-z]{2,3}(?:-[a-z0-9]{2,4}){0,2}(?:&page=[1-9][0-9]{0,5})?$/;

/** The header the middleware hands the target in (a rewrite does not carry a query string to a route handler). */
const MOVED_TO_HEADER = "x-bha-moved-to";

export function GET(request: Request): Response {
  const to = request.headers.get(MOVED_TO_HEADER);
  if (to === null || !BLOG_TARGET.test(to)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(null, { status: 301, headers: { Location: to } });
}

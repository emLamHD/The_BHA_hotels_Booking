/**
 * BHA-BLOG-001-CP05: the public origin of THIS site (`SITE_URL`, server-side), the one setting canonical links, `hreflang`, Open Graph, the sitemap and
 * robots are built from. It is never guessed from a request (a `Host` or forwarded header is chosen by the caller) and never the API's origin. When it is
 * absent or not a bare origin, `null`: the pages then omit what needs an absolute address (canonical, alternates, `og:url`, JSON-LD urls), the sitemap is not
 * produced and robots names no sitemap — nothing wrong is published in its place.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function getSiteOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.SITE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
    const bare = (url.pathname === "/" || url.pathname === "") && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
    if (secure && bare) return url.origin;
  } catch {
    // fall through: the value is never quoted back
  }
  console.error("[seo] SITE_URL is not a bare https origin (for example https://www.example.com); canonical links and the sitemap are off.");
  return null;
}

/** `origin` + an in-site path (it keeps its query). `null` when the origin is not configured. */
export const absoluteUrl = (origin: string | null, path: string): string | null => (origin ? `${origin}${path}` : null);

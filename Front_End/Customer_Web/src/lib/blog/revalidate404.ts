import { blogTargetOf } from "./blog";

/**
 * BHA-BLOG-001-CP04-CP05-C9: a Blog 404 can be a COPY. Next 13.4's client router cache restores the not-found payload of a Blog address on Back/Forward without asking the
 * server (an unpublished post, published since), and its not-found boundary leaves that state only when the pathname changes — a refresh at the same address does not
 * clear it. So when a Blog 404 is shown, ask the server once, with a plain same-origin GET of the same address (the status is all that is read): `404` is still true and
 * nothing more happens; `200` means the address is a real page now, and the reader is sent through `/blog-recover` (a pathname change, so the boundary lets go) to the
 * address the server answered with (the same one, or where an old slug now lives). Any other answer, a failed read or a reader who has already left changes nothing:
 * a missing page is never turned into an index, and nothing is retried. `attempted` is the loop stop: an address recovered once that is still shown as a 404 is not
 * recovered again until the server has said 404 for it.
 */
const attempted = new Set<string>();

export type Revalidation = "recovered" | "still-404" | "unconfirmed" | "left" | "skipped";

export async function revalidateBlog404(deps: {
  /** The address being shown (path and query). */
  href: string;
  origin: string;
  fetcher: typeof fetch;
  signal: AbortSignal;
  /** The address the reader is on now. */
  current: () => string;
  /** Goes to the recovery step for a validated Blog address. */
  recover: (target: string) => void;
}): Promise<Revalidation> {
  let response: Response;
  try {
    response = await deps.fetcher(deps.href, { cache: "no-store", credentials: "same-origin", headers: { Accept: "text/html" }, signal: deps.signal });
  } catch {
    return "unconfirmed";
  }
  void response.body?.cancel().catch(() => undefined);
  if (deps.signal.aborted || deps.current() !== deps.href) return "left";
  if (response.status === 404) {
    attempted.delete(deps.href);
    return "still-404";
  }
  if (response.status !== 200) return "unconfirmed";
  let answered = deps.href;
  if (response.redirected) {
    try {
      const url = new URL(response.url);
      if (url.origin !== deps.origin) return "unconfirmed";
      answered = url.pathname + url.search;
    } catch {
      return "unconfirmed";
    }
  }
  const target = blogTargetOf(answered);
  if (!target) return "unconfirmed";
  if (attempted.has(deps.href)) return "skipped";
  attempted.add(deps.href);
  deps.recover(target);
  return "recovered";
}

/**
 * A link from outside data (an RSS item, a news API) that is safe to put in
 * an href or src: absolute http(s) only, anything else becomes '#'.
 *
 * esc() only stops a value breaking out of the attribute; it does nothing
 * about the scheme, so `javascript:` from a feed would still run in the app's
 * origin when clicked. Parsing with URL also folds away the tricks a scheme
 * check by regex misses (case, leading whitespace/control characters, tabs or
 * newlines inside the scheme). Relative URLs are rejected on purpose: a feed
 * link always names its own host.
 */
export function safeUrl(u: unknown): string {
  if (typeof u !== 'string' || !u.trim()) return '#'
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : '#'
  } catch {
    return '#'
  }
}

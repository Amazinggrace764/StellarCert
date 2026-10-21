const DEFAULT_SAFE_PATH = "/";

/**
 * Validates a post-login redirect target against an allowlist of internal,
 * same-origin paths. Query-string params like `returnUrl` are attacker
 * controlled, so anything that isn't a plain relative path (e.g. an absolute
 * URL, a protocol-relative `//host` URL, or a backslash variant a browser
 * may reinterpret as protocol-relative) is rejected in favor of the fallback.
 */
export const getSafeRedirectPath = (
  candidate: string | null | undefined,
  fallback: string = DEFAULT_SAFE_PATH,
): string => {
  if (!candidate) return fallback;

  // Must start with a single '/' — rejects absolute URLs (https://evil.com),
  // scheme-relative URLs (//evil.com), and backslash variants (/\evil.com,
  // \\evil.com) that some browsers normalize into protocol-relative URLs.
  if (!/^\/(?!\/|\\)/.test(candidate)) return fallback;

  return candidate;
};

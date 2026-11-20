// Everything the runner sends off the machine (Linear comments, PR bodies) or
// keeps (the ledger) passes through here first.

const SECRET_PATTERNS: RegExp[] = [
  /lin_(?:api|oauth)_[A-Za-z0-9]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{30,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs (e.g. Supabase keys)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** True when text contains something shaped like a credential. */
export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => new RegExp(p.source).test(text));
}

/** Mask credentials and URL userinfo (https://user:token@host). */
export function redact(text: string): string {
  let out = text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1***@");
  for (const p of SECRET_PATTERNS) out = out.replace(p, "[redacted]");
  return out;
}

/**
 * Agent-written text that will be rendered on GitHub or Linear: no images or
 * raw HTML (both can fetch attacker URLs when a reviewer opens the page), no
 * @mentions, no collapsible markers that would break our own sections, capped.
 */
export function sanitizeForPublish(text: string, max = 3000): string {
  const clean = redact(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image removed]")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(^|[^\w`])@(?=[A-Za-z0-9-])/g, "$1@​")
    .replace(/^\+\+\+.*$/gm, "")
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}\n…(truncated)` : clean;
}

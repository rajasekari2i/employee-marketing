/**
 * WU-07 DoD item 1 / Architecture §18 / CLAUDE.md Constitution rule 9: "No
 * secret, token, password, precise coordinate or free-text reason in any
 * log line". The original implementation relied on pino's `redact.paths`
 * option (fast-redact), which only matches a fixed set of exact, literal
 * paths (`req.body.password`, bare top-level `password`, etc.) — adversarial
 * review live-verified this leaves every OTHER nesting depth completely
 * unprotected: `{ user: { credentials: { password } } }` or
 * `{ location: { latitude, longitude } }` logged in plaintext, since
 * fast-redact has no arbitrary-depth/recursive matching mode. That directly
 * contradicts the Constitution rule above, which makes no exception for
 * "as long as the field is nested exactly where we expected."
 *
 * This walks the ENTIRE object pino is about to serialize — regardless of
 * how deeply a sensitive key is nested, under what parent key, or whether
 * it's inside an array — and replaces any property whose *key* exactly
 * matches one of `SENSITIVE_KEYS` with a fixed censor value. Wired in as
 * pino's `formatters.log` hook, which (per pino's own formatter-ordering
 * docs) runs on the fully-assembled log object — after pino-http's own
 * `req`/`res` serializers have already turned those into plain objects —
 * and immediately before final JSON serialization, so this is the last
 * point to redact anything, from any source, before it becomes a log line.
 */
/**
 * User Story 4 (specs/001-company-user-auth/orchestration-plan.md),
 * decision #4b: `resetToken`, `currentPassword`, `newPassword`,
 * `confirmPassword` are genuinely new, unambiguous, sensitive-only key
 * names a future handler could log by accident. Deliberately **not**
 * adding bare `code` (verify-otp's 6-digit-OTP field) — `code` is also
 * this codebase's existing, non-sensitive field name for `Company.code`
 * and every `ProblemDetails.code`, and this matcher has no path-scoping,
 * so adding it would redact those too for no live benefit (pino-http's own
 * `req` serializer never includes `req.body` at all, confirmed repeatedly
 * during WU-07's own adversarial review rounds).
 */
const SENSITIVE_KEYS = new Set<string>([
  'password',
  'token',
  'authorization',
  'latitude',
  'longitude',
  'reasonText',
  'otp',
  'resetToken',
  'currentPassword',
  'newPassword',
  'confirmPassword',
]);

const REDACTED = '[REDACTED]';

export function deepRedact(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepRedact(item, seen));
  }

  if (value !== null && typeof value === 'object') {
    // A log object pino hands to `formatters.log` is built fresh per call
    // (not a reference into live application state a caller might reuse),
    // so returning a new object here — rather than mutating `value` in
    // place — cannot have any surprising effect on the caller; the `seen`
    // guard below is purely a defensive safeguard against a pathological
    // circular reference someone logs by accident, not an expected case.
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const result: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = SENSITIVE_KEYS.has(key)
        ? REDACTED
        : deepRedact(nestedValue, seen);
    }
    return result;
  }

  return value;
}

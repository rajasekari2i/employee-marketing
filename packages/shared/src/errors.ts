// Error-code vocabulary for the whole request pipeline (Architecture §4's
// RFC 9457 error envelope + WU-04/T028). `code` values here are the single
// source of truth both the NestJS `ProblemDetailsFilter`
// (apps/api/src/common/filters/problem-details.filter.ts) and the mobile app
// consume to map to the exact copy in PRD §5 (Constitution rule 5 — "one
// contract").
//
// This is the minimal set this work unit (WU-04, request pipeline) and its
// immediate follow-on (WU-05, auth core) need. Later slices (beats, visits,
// salary, ...) will add their own domain codes to this same list — this file
// is additive, never a place to rename/remove a code already shipped.

/** Every error `code` the API can currently return. */
export const ERROR_CODES = [
  'INVALID_CREDENTIALS',
  'ACCOUNT_INACTIVE',
  'TOKEN_EXPIRED',
  'TOKEN_REUSED',
  'FORBIDDEN_ROLE',
  'CROSS_TENANT',
  'VALIDATION_FAILED',
  'USERNAME_TAKEN',
  'COMPANY_CODE_TAKEN',
  'IDEMPOTENCY_KEY_REUSED',
  'OTP_INCORRECT',
  'OTP_EXPIRED',
  'OTP_ATTEMPTS_EXHAUSTED',
  'RATE_LIMITED',
  'NOT_FOUND',
  // WU-06 (contracts/files.md's `GET /files/:id`): a missing, malformed,
  // signature-invalid or expired signed file token. Deliberately its own
  // code rather than reusing `FORBIDDEN_ROLE` (that one means "your role
  // doesn't permit this", which isn't the case here — this route has no
  // JWT/role at all, @Public() by design, gated only by the query-string
  // token) or `INVALID_CREDENTIALS` (401; contracts/files.md calls for
  // "401/403 FORBIDDEN" and this codebase's `AppError` maps one status per
  // code, so this slice picks 403 uniformly — see files.service.ts).
  'FORBIDDEN',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status each code maps to — mirrors contracts/auth.md + Architecture §4. */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = {
  INVALID_CREDENTIALS: 401,
  ACCOUNT_INACTIVE: 403,
  TOKEN_EXPIRED: 401,
  TOKEN_REUSED: 409,
  FORBIDDEN_ROLE: 403,
  CROSS_TENANT: 403,
  VALIDATION_FAILED: 400,
  USERNAME_TAKEN: 409,
  COMPANY_CODE_TAKEN: 409,
  OTP_INCORRECT: 400,
  OTP_EXPIRED: 410,
  OTP_ATTEMPTS_EXHAUSTED: 429,
  IDEMPOTENCY_KEY_REUSED: 409,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  INTERNAL: 500,
};

/** Human-readable RFC 9457 `title` for each code (kept short, PRD copy wins in the client). */
export const ERROR_TITLES: Readonly<Record<ErrorCode, string>> = {
  INVALID_CREDENTIALS: 'Invalid credentials',
  ACCOUNT_INACTIVE: 'Account inactive',
  TOKEN_EXPIRED: 'Token expired',
  TOKEN_REUSED: 'Token reused',
  FORBIDDEN_ROLE: 'Forbidden',
  CROSS_TENANT: 'Forbidden',
  VALIDATION_FAILED: 'Validation failed',
  USERNAME_TAKEN: 'Username already taken',
  COMPANY_CODE_TAKEN: 'Company code already taken',
  OTP_INCORRECT: 'Incorrect OTP',
  OTP_EXPIRED: 'OTP expired',
  OTP_ATTEMPTS_EXHAUSTED: 'OTP attempts exhausted',
  IDEMPOTENCY_KEY_REUSED: 'Idempotency key reused',
  RATE_LIMITED: 'Too many requests',
  NOT_FOUND: 'Not found',
  FORBIDDEN: 'Forbidden',
  INTERNAL: 'Internal server error',
};

/** One entry of the RFC 9457 `errors` array (field-level validation detail). */
export interface ErrorDetail {
  path: string;
  message: string;
}

/**
 * The one error type every guard/pipe/interceptor/service in this codebase
 * should throw instead of a bare NestJS `HttpException` subclass, so a
 * single `ProblemDetailsFilter` can render every failure the same way
 * (Architecture §4's error envelope). `status` is derived from `code` via
 * {@link ERROR_STATUS} rather than passed separately, so a thrown error's
 * status can never drift from its code.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  get title(): string {
    return ERROR_TITLES[this.code];
  }
}

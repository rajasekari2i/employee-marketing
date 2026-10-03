import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import {
  AppError,
  ERROR_TITLES,
  type ErrorCode,
  type ErrorDetail,
} from '@field-sales/shared';
import { ClsService } from 'nestjs-cls';
import type { Request, Response } from 'express';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode | 'INTERNAL';
  detail: string;
  instance: string;
  requestId?: string;
  errors?: ErrorDetail[];
}

const PROBLEM_TYPE_BASE = 'https://api.fieldsales.app/errors';
const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * WU-04 DoD item 7 / Architecture §4's error envelope: catches *every*
 * exception thrown anywhere in the pipeline (`@Catch()` with no argument)
 * and renders it as a single RFC 9457 `application/problem+json` shape,
 * carrying this codebase's `code` vocabulary (`packages/shared/src/
 * errors.ts`) and the `x-request-id` `RequestIdMiddleware` stamped into CLS
 * for this request.
 *
 * Registered as a global `APP_FILTER` in `app.module.ts` (WU-04 DoD item
 * 10) so this is the *only* place an exception gets turned into an HTTP
 * response — guards, pipes, interceptors and handlers all just throw and
 * never format a response themselves.
 *
 * Three cases, in priority order:
 *   1. `AppError` (this codebase's own thrown type — every guard/pipe this
 *      work unit builds throws one of these) — status/code/detail/errors
 *      come straight off the instance.
 *   2. Any other `HttpException` (Nest's built-ins, and third-party guards
 *      like `@nestjs/throttler`'s `ThrottlerException`) — mapped by HTTP
 *      status to the closest matching `code` in this slice's vocabulary,
 *      since those libraries don't know about it.
 *   3. Anything else (a genuine bug — a thrown non-`Error`, a Prisma
 *      error that escaped a service, etc.) — never leaks its message to
 *      the caller (Constitution rule 9 — no secrets/internals in a
 *      response); logged server-side in full, returned as a bare `500
 *      INTERNAL`.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const resolved = this.resolve(exception);

    if (resolved.status >= 500) {
      // CLAUDE.md Constitution rule 9 / WU-07's redaction DoD: unlike the
      // `instance` field below (part of the HTTP response body, not a log
      // line), this message is written straight to the log — so it must
      // not carry the raw query string verbatim. A secret passed as a
      // query value (e.g. `GET /files/:id?token=...`) would otherwise
      // reach the log in plaintext here even though pino's own req/res
      // serializers (app.module.ts) already redact it elsewhere, since
      // this `Logger.error` call builds its own message string completely
      // independently of those serializers. Dropping the query string
      // entirely — same fix applied to pino's `url` field — removes the
      // leak without losing anything this message needs (the path is
      // what's useful for triage; the query value isn't).
      const sanitizedUrl = (request.originalUrl ?? request.url).split('?')[0];
      this.logger.error(
        `${request.method} ${sanitizedUrl} -> ${resolved.status} ${resolved.code}`,
        exception instanceof Error ? exception.stack : exception,
      );
    }

    const body: ProblemDetails = {
      type: `${PROBLEM_TYPE_BASE}/${resolved.code.toLowerCase().replace(/_/g, '-')}`,
      title: resolved.title,
      status: resolved.status,
      code: resolved.code,
      detail: resolved.detail,
      instance: request.originalUrl ?? request.url,
      requestId: this.safeGetRequestId(),
      ...(resolved.errors ? { errors: resolved.errors } : {}),
    };

    response
      .status(resolved.status)
      .header('Content-Type', PROBLEM_CONTENT_TYPE)
      .json(body);
  }

  private resolve(exception: unknown): {
    status: number;
    code: ErrorCode | 'INTERNAL';
    title: string;
    detail: string;
    errors?: ErrorDetail[];
  } {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        title: exception.title,
        detail: exception.message,
        errors: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      return this.resolveHttpException(exception);
    }

    return {
      status: 500,
      code: 'INTERNAL',
      title: ERROR_TITLES.INTERNAL,
      detail: 'An unexpected error occurred.',
    };
  }

  /**
   * Maps a non-`AppError` `HttpException` (Nest's own built-ins —
   * `NotFoundException` for an unmapped route, `ThrottlerException` from
   * `@nestjs/throttler`, etc.) onto this slice's `code` vocabulary by HTTP
   * status, since those exception classes don't carry one of our `code`s.
   */
  private resolveHttpException(exception: HttpException): {
    status: number;
    code: ErrorCode | 'INTERNAL';
    title: string;
    detail: string;
  } {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const detail =
      typeof response === 'string'
        ? response
        : ((response as { message?: string })?.message ?? exception.message);

    const code = this.codeForStatus(status);

    return {
      status,
      code,
      title: ERROR_TITLES[code] ?? exception.name,
      detail,
    };
  }

  private codeForStatus(status: number): ErrorCode | 'INTERNAL' {
    switch (status) {
      case 400:
        return 'VALIDATION_FAILED';
      case 401:
        return 'INVALID_CREDENTIALS';
      case 403:
        return 'FORBIDDEN_ROLE';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'IDEMPOTENCY_KEY_REUSED';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL';
    }
  }

  private safeGetRequestId(): string | undefined {
    try {
      return this.cls.get('requestId');
    } catch {
      // CLS context inactive (e.g. an exception thrown before
      // RequestIdMiddleware ever ran) — omit rather than fail the filter.
      return undefined;
    }
  }
}

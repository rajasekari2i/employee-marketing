import { createZodValidationPipe } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { AppError } from '@field-sales/shared';

/**
 * Project-wide `ZodValidationPipe` (WU-04 DoD item 5 / Architecture §4,
 * §9; Constitution rule 5 — "one contract"). Validates every `@Body()`,
 * `@Query()` and `@Param()` against the Zod schema attached to a
 * `createZodDto()` DTO class from `packages/shared` (schemas not yet added
 * — the first ones land with WU-05's `auth.schema.ts`); this pipe is
 * registered globally as `APP_PIPE` in `app.module.ts` so every route is
 * covered without each controller opting in (`@UsePipes` is unnecessary).
 *
 * Built via `nestjs-zod`'s `createZodValidationPipe` (rather than using its
 * default exported `ZodValidationPipe` as-is) solely to override what gets
 * thrown on failure: instead of `nestjs-zod`'s own `ZodValidationException`,
 * this throws this codebase's `AppError('VALIDATION_FAILED', ...)` so a
 * validation failure flows through the exact same `ProblemDetailsFilter` ->
 * RFC 9457 path as every guard-thrown error, using the same
 * `packages/shared/src/errors.ts` vocabulary (WU-04 DoD item 7) — no
 * special-casing of `nestjs-zod`'s exception type needed in the filter.
 */
export const ZodValidationPipe = createZodValidationPipe({
  createValidationException: (error: unknown) => {
    const zodError = error as ZodError;
    const details = Array.isArray(zodError?.issues)
      ? zodError.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }))
      : undefined;

    return new AppError(
      'VALIDATION_FAILED',
      'Request validation failed.',
      details,
    );
  },
});

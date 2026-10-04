import { z } from 'zod';

/**
 * Duration strings accepted for JWT TTL env vars, e.g. "15m", "60d", "3600s".
 * Kept intentionally simple (digits + unit) rather than a full duration parser.
 */
const durationString = z
  .string()
  .regex(/^\d+(ms|s|m|h|d)$/, 'must look like a duration, e.g. "15m" or "60d"');

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

/**
 * Schema for every environment variable the API process requires at boot.
 * This is the single source of truth (Constitution rule 5) — both
 * `apps/api/src/main.ts` and any script that needs env access should go
 * through `loadEnv()` below rather than reading `process.env` directly.
 */
export const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .url('DATABASE_URL must be a valid connection URL'),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: durationString.default('15m'),
  JWT_REFRESH_TTL: durationString.default('60d'),
  FILE_URL_SECRET: z
    .string()
    .min(32, 'FILE_URL_SECRET must be at least 32 characters'),
  // User Story 4, decision #1: a genuinely separate security boundary from
  // FILE_URL_SECRET (file-serving authority vs. password-reset authority
  // should not share a key), used to HMAC-sign the stateless `resetToken`.
  PASSWORD_RESET_SECRET: z
    .string()
    .min(32, 'PASSWORD_RESET_SECRET must be at least 32 characters'),
  RAILWAY_VOLUME_MOUNT_PATH: z
    .string()
    .min(1, 'RAILWAY_VOLUME_MOUNT_PATH is required'),
  SEED_SYSTEM_ADMIN_USERNAME: z
    .string()
    .min(1, 'SEED_SYSTEM_ADMIN_USERNAME is required'),
  SEED_SYSTEM_ADMIN_PASSWORD: z
    .string()
    .min(8, 'SEED_SYSTEM_ADMIN_PASSWORD must be at least 8 characters'),
  LOG_LEVEL: z.enum(logLevels).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates `source` (defaults to `process.env`) against {@link envSchema}.
 * Throws a `ZodError`-derived `Error` with a readable, multi-line message on
 * failure; callers that must hard-exit the process (e.g. `apps/api/src/main.ts`)
 * should catch and call `process.exit(1)` themselves rather than this module
 * doing so, so that `loadEnv` stays safely importable from scripts/tests.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

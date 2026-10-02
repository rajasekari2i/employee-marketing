// Placeholder entry point for @field-sales/shared.
// Later work units add the real Zod contract schemas (auth, companies,
// users, me, ...) and export them from here.

export { envSchema, loadEnv } from './env';
export type { Env } from './env';

export {
  RoleKey,
  roleKeySchema,
  UserStatus,
  userStatusSchema,
  CompanyStatus,
  companyStatusSchema,
} from './enums';

export { ERROR_CODES, ERROR_STATUS, ERROR_TITLES, AppError } from './errors';
export type { ErrorCode, ErrorDetail } from './errors';

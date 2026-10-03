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

export { loginSchema, refreshSchema, logoutSchema } from './auth.schema';
export type { LoginInput, RefreshInput, LogoutInput } from './auth.schema';

export {
  passwordPolicySchema,
  createCompanyAdminSchema,
  createCompanySchema,
  listCompaniesQuerySchema,
  updateCompanySchema,
} from './companies.schema';
export type {
  CreateCompanyAdminInput,
  CreateCompanyInput,
  ListCompaniesQuery,
  UpdateCompanyInput,
} from './companies.schema';

export {
  TENANT_ASSIGNABLE_ROLE_KEYS,
  tenantAssignableRoleKeySchema,
  createUserSchema,
  updateUserSchema,
  salaryRateSchema,
  listUsersQuerySchema,
} from './users.schema';
export type {
  TenantAssignableRoleKey,
  CreateUserInput,
  UpdateUserInput,
  SalaryRateInput,
  ListUsersQuery,
} from './users.schema';

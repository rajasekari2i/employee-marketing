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
  LocationSource,
  locationSourceSchema,
  LocationStatus,
  locationStatusSchema,
} from './enums';

export { ERROR_CODES, ERROR_STATUS, ERROR_TITLES, AppError } from './errors';
export type { ErrorCode, ErrorDetail } from './errors';

export {
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from './auth.schema';
export type {
  LoginInput,
  RefreshInput,
  LogoutInput,
  ForgotPasswordInput,
  VerifyOtpInput,
  ResetPasswordInput,
  ChangePasswordInput,
} from './auth.schema';

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

export {
  createShopSchema,
  updateShopSchema,
  listShopsQuerySchema,
} from './shops.schema';
export type {
  ShopLocationInput,
  CreateShopInput,
  UpdateShopInput,
  ListShopsQuery,
} from './shops.schema';

export {
  createBeatPlanSchema,
  updateBeatPlanSchema,
  listBeatPlansQuerySchema,
} from './beat-plans.schema';
export type {
  CreateBeatPlanInput,
  UpdateBeatPlanInput,
  ListBeatPlansQuery,
} from './beat-plans.schema';

export {
  createBrandSchema,
  createReasonSchema,
  updateBrandSchema,
  updateReasonSchema,
  reorderSchema,
} from './masters.schema';
export type {
  CreateBrandInput,
  CreateReasonInput,
  UpdateBrandInput,
  UpdateReasonInput,
  ReorderInput,
} from './masters.schema';

export { startBeatSchema, endBeatSchema } from './assignments.schema';
export type { StartBeatInput, EndBeatInput } from './assignments.schema';

export { submitVisitSchema, capturePinSchema } from './visits.schema';
export type { SubmitVisitInput, CapturePinInput } from './visits.schema';

export {
  nearbyShopsQuerySchema,
  addExtraStopSchema,
} from './extra-shops.schema';
export type {
  NearbyShopsQuery,
  AddExtraStopInput,
  NewShopInput,
} from './extra-shops.schema';

export { myVisitsQuerySchema } from './my-visits.schema';
export type { MyVisitsQuery } from './my-visits.schema';

export { executiveTotalsQuerySchema } from './reports.schema';
export type { ExecutiveTotalsQuery } from './reports.schema';

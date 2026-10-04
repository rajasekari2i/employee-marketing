import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  AppError,
  loadEnv,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type RoleKey,
  type VerifyOtpInput,
} from '@field-sales/shared';

import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';
import { LogSmsAdapter } from '../../infra/sms/log-sms.adapter';
import type { SmsAdapter } from '../../infra/sms/sms-adapter.interface';
import * as password from '../../infra/security/password';
import { LoginThrottlerGuard } from '../../common/guards/login-throttler.guard';
import { TokenService, type TokenPair } from './token.service';

/**
 * Own module-level, unextended Prisma client — same established pattern as
 * `active-account.guard.ts` (WU-04), reused deliberately rather than a new
 * competing pattern (WU-05's design notes). `/auth/login` is `@Public()`,
 * so `TransactionInterceptor` has not opened a transaction/CLS `tx` by the
 * time this service runs (it skips public routes) — this service must open
 * its own `$transaction` and `set_config` the right RLS session variable
 * before every `User` read, exactly like `ActiveAccountGuard` does.
 */
const prisma = new PrismaClient();

const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.';
const ACCOUNT_INACTIVE_MESSAGE =
  'Your account is inactive. Contact your administrator.';

// User Story 4 (specs/001-company-user-auth/orchestration-plan.md) constants.
const OTP_CODE_LENGTH = 6;
/** FR-012. */
const OTP_TTL_MS = 10 * 60 * 1000;
/** FR-012. */
const MAX_OTP_ATTEMPTS = 5;
/** FR-012. */
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
/** Decision #1: resetToken's own embedded lifetime. */
const RESET_TOKEN_TTL_SECONDS = 10 * 60;
/** Same sentinel convention `token.service.ts`/`files.service.ts` already use for a `null` companyId inside a token payload. */
const NULL_COMPANY_SENTINEL = '-';

const OTP_INCORRECT_MESSAGE = 'That code is not correct.';
const OTP_EXPIRED_MESSAGE = 'That code has expired. Request a new code.';
const OTP_ATTEMPTS_EXHAUSTED_MESSAGE =
  'Too many incorrect attempts. Request a new code.';
const RESET_TOKEN_INVALID_MESSAGE = 'Reset token is invalid or has expired.';
const INVALID_CURRENT_PASSWORD_MESSAGE = 'Current password is incorrect.';
const PASSWORD_UNCHANGED_MESSAGE =
  'New password must be different from your current password.';

/**
 * Fixed dummy mobile number (shape-identical to a real one, 13 characters)
 * used to build the one generic placeholder mask shared by every
 * enumeration-resistant branch (decision #3b/#5) — "doesn't exist", "no
 * mobile on file", "mobile too short to mask", and "within the resend
 * cooldown" all return this exact same string, so none of them is
 * distinguishable from a real masked mobile by shape.
 */
const PLACEHOLDER_MOBILE = '+910000000000';

/**
 * User Story 4, decision #5 (the masked-mobile format, found by plan
 * review — neither contracts/auth.md nor data-model.md defines an
 * algorithm, and this repo's own two illustrative examples disagreed).
 * Keeps the first 3 characters of `mobile` as-is, masks every character
 * from index 3 up to (length - 3) with `•`, keeps the last 3 characters as
 * -is — applied to a 13-character E.164 Indian number this reproduces
 * contracts/auth.md's own example exactly (3 kept + 7 masked + 3 kept).
 * Returns `null` when `mobile.length < 8` (slicing a string that short
 * would overlap or garble into a wrong-shape mask) — callers fall back to
 * the same fixed generic placeholder used for every other
 * enumeration-resistant branch.
 */
function maskMobile(mobile: string): string | null {
  if (mobile.length < 8) {
    return null;
  }
  const first = mobile.slice(0, 3);
  const last = mobile.slice(-3);
  const maskedLength = mobile.length - 6;
  return `${first}${'•'.repeat(maskedLength)}${last}`;
}

// PLACEHOLDER_MOBILE is 13 characters (well above the 8-character floor
// above), so this is always a real, non-null string.
const GENERIC_MASKED_MOBILE = maskMobile(PLACEHOLDER_MOBILE) as string;

/** A random 6-digit OTP code, zero-padded (e.g. "004213"). */
function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_CODE_LENGTH)
    .toString()
    .padStart(OTP_CODE_LENGTH, '0');
}

/** The subset of a looked-up `User` row this story's OTP flow needs. */
interface OtpCandidate {
  id: string;
  companyId: string | null;
  mobile: string | null;
  passwordHash: string | null;
}

export interface LoginResultUser {
  id: string;
  name: string;
  role: RoleKey;
  companyId: string | null;
  permissions: string[];
}

export interface LoginResult extends TokenPair {
  user: LoginResultUser;
}

/** The subset of a looked-up `User` row (+ its role) this service needs. */
interface AuthCandidate {
  id: string;
  name: string;
  companyId: string | null;
  passwordHash: string | null;
  status: string;
  tokenVersion: number;
  role: { key: RoleKey; permissions: string[] };
}

@Injectable()
export class AuthService {
  /**
   * Directly instantiated, not Nest-DI-wired — same established pattern
   * `FilesService` already uses for `StorageAdapter`/`LocalVolumeAdapter`
   * (`this.storage = new LocalVolumeAdapter()`), reused here rather than
   * inventing a different wiring convention for an interface with exactly
   * one implementation so far.
   */
  private readonly smsAdapter: SmsAdapter;

  constructor(
    private readonly tokens: TokenService,
    private readonly loginThrottler: LoginThrottlerGuard,
  ) {
    this.smsAdapter = new LogSmsAdapter();
  }

  /**
   * `POST /auth/login` (WU-05 DoD item 3). `companyCode` omitted scopes the
   * lookup to `companyId: null` (`SYSTEM_ADMIN` only) per research.md #1.
   *
   * Error-ordering is deliberate: the company's own suspension status is
   * checked only *after* a correct username+password match (same code path
   * and message as an inactive user, so neither case is distinguishable
   * from the other — FR-007 — and, as a side benefit, a wrong-credentials
   * guess against a suspended company's username leaks nothing about that
   * company's status either).
   */
  async login(input: LoginInput): Promise<LoginResult> {
    // FR-010's 6-failures-per-15-min lockout. Checked here (against the
    // `LoginThrottlerGuard` instance this service actually got via
    // constructor injection), NOT via `@UseGuards(LoginThrottlerGuard)` on
    // the controller — see that class's "WU-05 addendum" doc comment for
    // the real, live-verified Nest DI pitfall (a class used as both a
    // provider and a `@UseGuards()` target gets two independent instances
    // with two independent attempt-count Maps) that makes the decorator
    // form silently non-functional.
    this.loginThrottler.assertNotLocked(input.username);

    let companyId: string | null = null;

    if (input.companyCode) {
      const company = await prisma.company.findUnique({
        where: { code: input.companyCode },
      });
      if (!company) {
        this.loginThrottler.registerFailedAttempt(input.username);
        throw new AppError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
      }
      companyId = company.id;
    }

    const candidate = await this.findCandidate(companyId, input.username);

    // `candidate.passwordHash` is `null` for any row that can never sign in
    // (FR-008: EMPLOYEE rows never have one) — short-circuit before calling
    // `password.verify()` rather than letting it reject a null hash itself,
    // so "no such user"/"user can't sign in"/"wrong password" all produce
    // the exact same branch and the exact same message (FR-007's "identical
    // message either way", generalised to every failure shape here).
    const passwordOk = Boolean(
      candidate?.passwordHash &&
      (await password.verify(candidate.passwordHash, input.password)),
    );

    if (!candidate || !passwordOk) {
      this.loginThrottler.registerFailedAttempt(input.username);
      throw new AppError('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
    }

    this.loginThrottler.clearAttempts(input.username);

    const companyActive = await this.isCompanyActive(companyId);
    if (candidate.status !== 'ACTIVE' || !companyActive) {
      throw new AppError('ACCOUNT_INACTIVE', ACCOUNT_INACTIVE_MESSAGE);
    }

    const pair = await this.tokens.issueTokenPair({
      sub: candidate.id,
      companyId: candidate.companyId,
      role: candidate.role.key,
      permissions: candidate.role.permissions,
      ver: candidate.tokenVersion,
    });

    await this.touchLastLogin(companyId, candidate.id);

    return {
      ...pair,
      user: {
        id: candidate.id,
        name: candidate.name,
        role: candidate.role.key,
        companyId: candidate.companyId,
        permissions: candidate.role.permissions,
      },
    };
  }

  /** `POST /auth/refresh` (WU-05 DoD item 4). */
  async refresh(rawToken: string): Promise<TokenPair> {
    const consumed = await this.tokens.consumeRefreshToken(rawToken);

    if (!consumed.ok) {
      if (consumed.reason === 'REUSED') {
        throw new AppError(
          'TOKEN_REUSED',
          'This refresh token was already used. The session has been revoked; sign in again.',
        );
      }
      // INVALID and EXPIRED are deliberately reported identically — same
      // reasoning as login's "identical message either way" (contracts/
      // auth.md only documents TOKEN_EXPIRED/TOKEN_REUSED for this route;
      // there is no third code to distinguish an unknown/malformed token
      // from a genuinely expired one, and there shouldn't be one that
      // leaks which).
      throw new AppError(
        'TOKEN_EXPIRED',
        'Refresh token is invalid or has expired.',
      );
    }

    const candidate = await this.findById(consumed.companyId, consumed.userId);
    const companyActive = await this.isCompanyActive(consumed.companyId);

    if (!candidate || candidate.status !== 'ACTIVE' || !companyActive) {
      throw new AppError(
        'TOKEN_EXPIRED',
        'Refresh token is invalid or has expired.',
      );
    }

    return this.tokens.issueTokenPair(
      {
        sub: candidate.id,
        companyId: candidate.companyId,
        role: candidate.role.key,
        permissions: candidate.role.permissions,
        ver: candidate.tokenVersion,
      },
      consumed.familyId,
    );
  }

  /** `POST /auth/logout` (WU-05 DoD item 5). */
  async logout(rawToken: string): Promise<void> {
    await this.tokens.revokeRefreshToken(rawToken);
  }

  /**
   * `POST /auth/forgot-password` (User Story 4, DoD item 3 / decisions
   * #3a/#3b/#9). Always returns `200 { maskedMobile }` with identical
   * shape and timing whether or not the username exists (FR-011) — the
   * only branch that creates a real `OtpChallenge`/calls
   * `SmsAdapter.send()` is an existing, non-Employee (has a
   * `passwordHash`) user with a mobile of plausible length, outside its
   * own 30-second resend cooldown. Every other case (doesn't exist, bad
   * `companyCode`, no mobile, mobile too short to mask, within cooldown)
   * returns the exact same generic placeholder, with no new `OtpChallenge`
   * row created.
   */
  async forgotPassword(
    input: ForgotPasswordInput,
  ): Promise<{ maskedMobile: string }> {
    const resolved = await this.resolveCompanyIdForEnumerationResistantLookup(
      input.companyCode,
    );
    if (!resolved.ok) {
      return { maskedMobile: GENERIC_MASKED_MOBILE };
    }

    const candidate = await this.findOtpCandidate(
      resolved.companyId,
      input.username,
    );
    if (!candidate?.passwordHash || !candidate.mobile) {
      return { maskedMobile: GENERIC_MASKED_MOBILE };
    }

    const masked = maskMobile(candidate.mobile);
    if (!masked) {
      return { maskedMobile: GENERIC_MASKED_MOBILE };
    }

    const lastChallenge = await this.findLatestOtpChallenge(candidate.id);
    if (
      lastChallenge &&
      Date.now() - lastChallenge.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
    ) {
      return { maskedMobile: GENERIC_MASKED_MOBILE };
    }

    const code = generateOtpCode();
    const codeHash = await password.hash(code);
    await prisma.otpChallenge.create({
      data: {
        userId: candidate.id,
        codeHash,
        purpose: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });

    await this.smsAdapter.send(
      candidate.mobile,
      `Your Field Sales verification code is ${code}. It expires in 10 minutes.`,
    );

    return { maskedMobile: masked };
  }

  /**
   * `POST /auth/verify-otp` (DoD item 4 / decisions #2/#3a/#3b). Finds the
   * latest NOT-YET-CONSUMED `OtpChallenge` (`consumedAt: null` only — no
   * `expiresAt` filter at the DB level, so a real-but-expired challenge
   * stays findable rather than collapsing into the same "nothing found"
   * bucket a nonexistent username already produces, which would make
   * `OTP_EXPIRED` unreachable). Check order: no row at all -> `OTP_
   * INCORRECT`; expired -> `OTP_EXPIRED`; attempts exhausted ->
   * `OTP_ATTEMPTS_EXHAUSTED`; wrong code -> increments attempts,
   * `OTP_INCORRECT`; correct code -> sets `consumedAt` (decision #2) and
   * mints a `resetToken` (decision #1).
   */
  async verifyOtp(input: VerifyOtpInput): Promise<{ resetToken: string }> {
    const resolved = await this.resolveCompanyIdForEnumerationResistantLookup(
      input.companyCode,
    );
    if (!resolved.ok) {
      throw new AppError('OTP_INCORRECT', OTP_INCORRECT_MESSAGE);
    }

    const candidate = await this.findOtpCandidate(
      resolved.companyId,
      input.username,
    );
    if (!candidate?.passwordHash) {
      throw new AppError('OTP_INCORRECT', OTP_INCORRECT_MESSAGE);
    }

    const challenge = await prisma.otpChallenge.findFirst({
      where: {
        userId: candidate.id,
        purpose: 'PASSWORD_RESET',
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!challenge) {
      throw new AppError('OTP_INCORRECT', OTP_INCORRECT_MESSAGE);
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new AppError('OTP_EXPIRED', OTP_EXPIRED_MESSAGE);
    }

    if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
      throw new AppError(
        'OTP_ATTEMPTS_EXHAUSTED',
        OTP_ATTEMPTS_EXHAUSTED_MESSAGE,
      );
    }

    const codeOk = await password.verify(challenge.codeHash, input.code);
    if (!codeOk) {
      const updated = await prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      const attemptsRemaining = Math.max(
        0,
        MAX_OTP_ATTEMPTS - updated.attempts,
      );
      throw new AppError(
        'OTP_INCORRECT',
        `${OTP_INCORRECT_MESSAGE} ${attemptsRemaining} attempt(s) remaining.`,
        [{ path: 'attemptsRemaining', message: String(attemptsRemaining) }],
      );
    }

    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });

    const resetToken = this.signResetToken(
      challenge.id,
      candidate.id,
      resolved.companyId,
    );
    return { resetToken };
  }

  /**
   * `POST /auth/reset-password` (DoD item 5 / decisions #1/#2/#9).
   * Verifies `resetToken`: decode + HMAC-verify, confirm `userId` matches,
   * confirm `consumedAt IS NOT NULL` (decision #2 — proving a correct OTP
   * code really was accepted for this challenge) and the token's own
   * embedded `exp` hasn't passed. Any failure collapses to the identical
   * `TOKEN_EXPIRED` (401) — contracts/auth.md's error vocabulary for this
   * route has no "already used"/"tampered" distinction to report. On
   * success, revokes every other active session for that user (FR-014,
   * decision #9).
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const claims = this.verifyResetToken(input.resetToken);
    if (!claims) {
      throw new AppError('TOKEN_EXPIRED', RESET_TOKEN_INVALID_MESSAGE);
    }

    // `OtpChallenge` is not RLS-protected (Architecture §5 exemption
    // list) — a plain, unscoped lookup by primary key.
    const challenge = await prisma.otpChallenge.findUnique({
      where: { id: claims.otpChallengeId },
    });
    if (
      !challenge ||
      challenge.userId !== claims.userId ||
      !challenge.consumedAt
    ) {
      throw new AppError('TOKEN_EXPIRED', RESET_TOKEN_INVALID_MESSAGE);
    }

    await prisma.$transaction(async (tx) => {
      await this.setRlsContext(tx, claims.companyId);

      const user = await tx.user.findUnique({
        where: { id: claims.userId },
        select: { id: true, passwordHash: true },
      });
      if (!user) {
        throw new AppError('TOKEN_EXPIRED', RESET_TOKEN_INVALID_MESSAGE);
      }

      await this.assertNewPasswordDiffers(user.passwordHash, input.newPassword);

      const newHash = await password.hash(input.newPassword);
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
      });
    });

    await this.tokens.revokeAllRefreshTokens(claims.userId);
  }

  /**
   * `POST /auth/change-password` (DoD item 6 / decision #9). `payload` is
   * `request.user` — the already-verified access token claims attached by
   * `JwtAuthGuard`; `currentPassword` is checked against the live stored
   * hash (`INVALID_CREDENTIALS` if wrong). On success, revokes every other
   * active session for that user (FR-014, decision #9) — including,
   * potentially, the very session that just authenticated this call.
   */
  async changePassword(
    payload: AccessTokenPayload,
    input: ChangePasswordInput,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await this.setRlsContext(tx, payload.companyId);

      const user = await tx.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, passwordHash: true },
      });

      const currentOk = Boolean(
        user?.passwordHash &&
        (await password.verify(user.passwordHash, input.currentPassword)),
      );
      if (!user || !currentOk) {
        throw new AppError(
          'INVALID_CREDENTIALS',
          INVALID_CURRENT_PASSWORD_MESSAGE,
        );
      }

      await this.assertNewPasswordDiffers(user.passwordHash, input.newPassword);

      const newHash = await password.hash(input.newPassword);
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newHash, tokenVersion: { increment: 1 } },
      });
    });

    await this.tokens.revokeAllRefreshTokens(payload.sub);
  }

  /**
   * Opens its own tenant-scoped (or system-context-scoped) transaction and
   * looks up a `User` by case-insensitive `username` — the exact pattern
   * `active-account.guard.ts` uses, reused rather than duplicated with a
   * different shape. `companyId: null` additionally filters to
   * `role.key = SYSTEM_ADMIN` (research.md #1) — an ordinary tenant user
   * can never have `companyId: null`, but being explicit here matches the
   * work unit's design note precisely and reads clearly.
   */
  private async findCandidate(
    companyId: string | null,
    username: string,
  ): Promise<AuthCandidate | null> {
    return prisma.$transaction(async (tx) => {
      await this.setRlsContext(tx, companyId);

      return tx.user.findFirst({
        where: {
          companyId,
          username: { equals: username, mode: 'insensitive' },
          ...(companyId === null ? { role: { key: 'SYSTEM_ADMIN' } } : {}),
        },
        select: {
          id: true,
          name: true,
          companyId: true,
          passwordHash: true,
          status: true,
          tokenVersion: true,
          role: { select: { key: true, permissions: true } },
        },
      });
    });
  }

  /** Same RLS dance as {@link findCandidate}, but by primary key — used by `refresh()`. */
  private async findById(
    companyId: string | null,
    userId: string,
  ): Promise<AuthCandidate | null> {
    return prisma.$transaction(async (tx) => {
      await this.setRlsContext(tx, companyId);

      return tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          companyId: true,
          passwordHash: true,
          status: true,
          tokenVersion: true,
          role: { select: { key: true, permissions: true } },
        },
      });
    });
  }

  private async touchLastLogin(
    companyId: string | null,
    userId: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await this.setRlsContext(tx, companyId);
      await tx.user.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });
    });
  }

  /** `Company` is not RLS-protected (Architecture §5 exemption list) — a plain read, no session variable needed. */
  private async isCompanyActive(companyId: string | null): Promise<boolean> {
    if (!companyId) {
      // SYSTEM_ADMIN belongs to no company.
      return true;
    }
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });
    return company?.status === 'ACTIVE';
  }

  /**
   * `set_config(..., true)` is transaction-scoped (`SET LOCAL` semantics)
   * and must run on the same connection as the query that follows — only
   * guaranteed inside one `$transaction` callback, same reasoning as
   * `active-account.guard.ts`.
   */
  private async setRlsContext(
    tx: Prisma.TransactionClient,
    companyId: string | null,
  ): Promise<void> {
    if (companyId) {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
    } else {
      await tx.$executeRaw`SELECT set_config('app.is_system_context', 'true', true)`;
    }
  }

  /**
   * User Story 4, decision #3a: resolves an optional `companyCode` into a
   * `companyId` (`null` = `SYSTEM_ADMIN` scope, for an omitted field) the
   * same *lookup mechanism* `login()` uses (`Company.findUnique({ where:
   * { code } })`) — but, deliberately, NOT the same *outcome* on failure.
   * `login()` throws a distinguishable `INVALID_CREDENTIALS` the moment a
   * `companyCode` fails to resolve, which is correct there (no
   * enumeration-resistance requirement at all) but would itself become a
   * brand-new side channel here: `forgot-password`/`verify-otp` must not
   * let a bad `companyCode` be distinguishable from a bad `username`
   * (decision #3b). Callers collapse an `{ ok: false }` result into the
   * exact same generic branch a nonexistent username already produces,
   * before `User`/`OtpChallenge` is ever touched.
   */
  private async resolveCompanyIdForEnumerationResistantLookup(
    companyCode: string | undefined,
  ): Promise<{ ok: true; companyId: string | null } | { ok: false }> {
    if (!companyCode) {
      return { ok: true, companyId: null };
    }
    const company = await prisma.company.findUnique({
      where: { code: companyCode },
    });
    if (!company) {
      return { ok: false };
    }
    return { ok: true, companyId: company.id };
  }

  /**
   * Case-insensitive `username` lookup scoped to `companyId` — the exact
   * same RLS dance and query shape as {@link findCandidate}, reused rather
   * than duplicated with a different shape (decision #3b explicitly calls
   * for mirroring `findCandidate`'s existing lookup).
   */
  private async findOtpCandidate(
    companyId: string | null,
    username: string,
  ): Promise<OtpCandidate | null> {
    return prisma.$transaction(async (tx) => {
      await this.setRlsContext(tx, companyId);

      return tx.user.findFirst({
        where: {
          companyId,
          username: { equals: username, mode: 'insensitive' },
          ...(companyId === null ? { role: { key: 'SYSTEM_ADMIN' } } : {}),
        },
        select: { id: true, companyId: true, mobile: true, passwordHash: true },
      });
    });
  }

  /**
   * `OtpChallenge` is one of Architecture §5's documented RLS exemptions
   * (data-model.md's entity-relationship summary) — a plain, unscoped
   * read, no session variable needed. Used by `forgotPassword`'s
   * 30-second resend-cooldown check (decision #3b).
   */
  private async findLatestOtpChallenge(userId: string) {
    return prisma.otpChallenge.findFirst({
      where: { userId, purpose: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * FR-013's "differs from the current password" half — needs the live
   * stored hash, so it can't live in a Zod schema (packages/shared's
   * `resetPasswordSchema`/`changePasswordSchema` only enforce the
   * length/letter+digit/cross-field-match halves).
   */
  private async assertNewPasswordDiffers(
    currentHash: string | null,
    newPassword: string,
  ): Promise<void> {
    if (currentHash && (await password.verify(currentHash, newPassword))) {
      throw new AppError('VALIDATION_FAILED', PASSWORD_UNCHANGED_MESSAGE);
    }
  }

  /**
   * User Story 4, decision #1: mirrors `files.service.ts`'s own
   * `signToken`/`verifyToken`/`hmac`/`safeEqual` pattern exactly, with its
   * own `PASSWORD_RESET_SECRET` rather than `FILE_URL_SECRET` (a
   * genuinely separate security boundary — file-serving authority and
   * password-reset authority should not share a key).
   *
   * **On the 4th (`companyId`) segment, beyond decision #1's own summary
   * payload `${otpChallengeId}|${userId}|${exp}`**: `reset-password` must
   * update `User.passwordHash`, and `"users"` is `FORCE ROW LEVEL
   * SECURITY`'d (migration `20261002110942_rls_user_fileobject`) — no row
   * is visible to this app's own `app_user` connection unless
   * `app.company_id` (or `app.is_system_context`) is already set *before*
   * the query runs, and there is no way to read a user's own `companyId`
   * first to decide which to set, because reading it is exactly what's
   * gated. This is the identical chicken-and-egg problem
   * `files.service.ts`'s own `signToken` doc comment describes solving by
   * embedding `companyId` in its token as non-secret routing metadata —
   * `verify-otp` already knows the caller's resolved `companyId` (decision
   * #3a) at the exact moment it mints this token, so carrying it here is
   * this route's way of breaking that same chicken-and-egg problem.
   * Deliberate, documented deviation from decision #1's literal 3-segment
   * payload text: it changes nothing about decision #2's verification
   * (`userId` equality, `consumedAt`, `exp` are all still checked exactly
   * as specified) — it only adds what's structurally necessary to find
   * and update the row at all.
   */
  private signResetToken(
    otpChallengeId: string,
    userId: string,
    companyId: string | null,
  ): string {
    const exp = Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_SECONDS;
    const companySegment = companyId ?? NULL_COMPANY_SENTINEL;
    const payload = `${otpChallengeId}|${userId}|${companySegment}|${exp}`;
    const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
    const signature = this.hmacResetToken(payload);
    return `${payloadB64}.${signature}`;
  }

  /**
   * Inverse of {@link signResetToken}. Returns `null` for anything
   * malformed, signature-invalid or expired — `resetPassword` maps that
   * uniformly to `TOKEN_EXPIRED` without distinguishing which (same
   * "don't reveal which" posture `files.service.ts`'s own `verifyToken`
   * already uses).
   */
  private verifyResetToken(token: string): {
    otpChallengeId: string;
    userId: string;
    companyId: string | null;
  } | null {
    if (!token) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const [payloadB64, signature] = parts;

    let payload: string;
    try {
      payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    const expectedSignature = this.hmacResetToken(payload);
    if (!this.safeEqual(signature, expectedSignature)) {
      return null;
    }

    const segments = payload.split('|');
    if (segments.length !== 4) {
      return null;
    }
    const [otpChallengeId, userId, companySegment, expStr] = segments;
    const exp = Number(expStr);
    if (
      !otpChallengeId ||
      !userId ||
      !companySegment ||
      !Number.isFinite(exp)
    ) {
      return null;
    }
    if (Math.floor(Date.now() / 1000) > exp) {
      return null;
    }

    return {
      otpChallengeId,
      userId,
      companyId:
        companySegment === NULL_COMPANY_SENTINEL ? null : companySegment,
    };
  }

  private hmacResetToken(payload: string): string {
    const secret = loadEnv().PASSWORD_RESET_SECRET;
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  /** Constant-time signature comparison — same reasoning as `files.service.ts`'s own `safeEqual`. */
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }
}

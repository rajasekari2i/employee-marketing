import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppError, type LoginInput, type RoleKey } from '@field-sales/shared';

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
  constructor(
    private readonly tokens: TokenService,
    private readonly loginThrottler: LoginThrottlerGuard,
  ) {}

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
}

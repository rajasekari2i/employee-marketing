import { randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { loadEnv, type RoleKey } from '@field-sales/shared';

import * as password from '../../infra/security/password';
import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';

/**
 * Own module-level Prisma client, same established pattern as
 * `active-account.guard.ts` / `transaction.interceptor.ts` /
 * `idempotency.interceptor.ts` (WU-03/WU-04) — there is still no shared
 * `PrismaService` to inject. `RefreshToken` is NOT in `tenant.extension.ts`'s
 * `TENANT_MODELS` set and is NOT covered by the WU-03 RLS migration
 * (Architecture §5's documented exemption list — same as `Company`, `Role`,
 * `AuditEvent`, `IdempotencyKey`), so a plain, unextended client talking to
 * the ordinary `app_user` (`DATABASE_URL`) connection can read/write it with
 * no session variable needed — unlike `auth.service.ts`'s own client, which
 * *does* need the `set_config` dance before touching `User`.
 */
const prisma = new PrismaClient();

/** Claims this service needs to mint an access token; `jti` is generated internally. */
export interface AccessTokenClaims {
  sub: string;
  companyId: string | null;
  role: RoleKey;
  permissions: string[];
  ver: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

type ConsumeFailureReason = 'INVALID' | 'EXPIRED' | 'REUSED';

export type ConsumeRefreshTokenResult =
  | { ok: true; userId: string; companyId: string | null; familyId: string }
  | { ok: false; reason: ConsumeFailureReason };

const MS_PER_UNIT: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses the same simple duration-string format `packages/shared/src/env.ts`
 * already validates at boot (`/^\d+(ms|s|m|h|d)$/`) into milliseconds, so
 * `JWT_REFRESH_TTL` (e.g. `"60d"`) can be turned into a concrete
 * `RefreshToken.expiresAt` `Date`. Not exported from `env.ts` itself (out of
 * this work unit's file scope to extend) — small enough to own here.
 */
function parseDurationMs(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
  if (!match) {
    throw new Error(`Invalid duration string: "${duration}"`);
  }
  return Number(match[1]) * MS_PER_UNIT[match[2]];
}

/**
 * WU-05 DoD item 2: HS512 access tokens and rotating refresh tokens.
 *
 * **Refresh token lookup scheme (WU-05 critical design note)**: a refresh
 * token's raw opaque value returned to the client is
 * `"<RefreshToken.id>.<companyId-or-'-'>.<secret>"`:
 *   - `id` is the `RefreshToken` row's own primary key, letting `/auth/
 *     refresh` find the row by an indexed `findUnique` instead of a
 *     full-table scan over every stored `tokenHash` (argon2 hashes can't be
 *     queried by equality the way a plain SHA-256 digest could — each
 *     hash embeds its own salt, so "hash the presented secret and compare
 *     column equality" doesn't work; `argon2.verify` needs the *specific*
 *     stored hash to check against, hence looking it up by `id` first).
 *   - `companyId` is carried as routing metadata, not a secret: `User`
 *     (unlike `RefreshToken`) IS RLS-protected (WU-03), and the policy
 *     requires the caller to already know+set the exact `companyId` (or
 *     the `is_system_context` flag for a `null` one) *before* the row
 *     becomes visible — there is no way to read a `User` row's own
 *     `companyId` to decide which session variable to set, because
 *     reading it is exactly what's gated. Embedding it in the opaque token
 *     breaks that chicken-and-egg problem. This is safe to trust blindly
 *     *after* the `id`+`secret` pair has been verified against the stored
 *     argon2 hash (proving the caller holds a genuine, un-tampered token
 *     this service issued) — and even an attempt to tamper with just this
 *     segment while keeping `id`+`secret` valid gains nothing: the
 *     `userId` driving the subsequent `User` lookup comes from the
 *     already-verified `RefreshToken` row itself (server-side), never
 *     from this segment, so a wrong `companyId` here only ever makes the
 *     RLS-scoped lookup return nothing (safe failure), not a cross-tenant
 *     read. The literal string `-` is the sentinel for `null` (System
 *     Admin).
 *   - `secret` is `crypto.randomBytes(32)` (256 bits), base64url-encoded —
 *     only its argon2id hash (via `infra/security/password.ts`, the same
 *     helper used for user passwords) is ever persisted, in
 *     `RefreshToken.tokenHash`; the raw value is returned to the client
 *     exactly once (here) and never stored.
 *
 * None of `id`, `companyId`, or `secret` contain the `.` separator (`id` is
 * a Prisma `uuid()`, `companyId` is a Prisma `uuid()` or the `-` sentinel,
 * `secret` is base64url — none of those alphabets include `.`), so a
 * simple 3-way `split('.')` round-trips exactly.
 */
@Injectable()
export class TokenService {
  private readonly jwtService: JwtService;
  /** Seconds, not the raw "15m"-style string — `@nestjs/jwt`'s `expiresIn`
   * option types `string` values as a narrow `ms`-style template-literal
   * union (`StringValue`), which a value loaded from `process.env` can
   * never statically satisfy; a plain number of seconds sidesteps that
   * without a type-unsafe cast. */
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlMs: number;

  constructor() {
    const env = loadEnv();
    this.jwtService = new JwtService({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { algorithm: 'HS512' },
      verifyOptions: { algorithms: ['HS512'] },
    });
    this.accessTokenTtlSeconds = Math.round(
      parseDurationMs(env.JWT_ACCESS_TTL) / 1000,
    );
    this.refreshTokenTtlMs = parseDurationMs(env.JWT_REFRESH_TTL);
  }

  /**
   * Signs a 15-minute (default) HS512 access token whose claims match
   * `AccessTokenPayload` (apps/api/src/common/guards/jwt-auth.guard.ts)
   * exactly — that guard is the sole authority on this shape and was built
   * first (WU-04) precisely so this service has nothing to invent.
   */
  signAccessToken(claims: AccessTokenClaims): string {
    const payload: AccessTokenPayload = {
      sub: claims.sub,
      companyId: claims.companyId,
      role: claims.role,
      permissions: claims.permissions,
      jti: randomUUID(),
      ver: claims.ver,
    };

    return this.jwtService.sign(payload, {
      algorithm: 'HS512',
      expiresIn: this.accessTokenTtlSeconds,
    });
  }

  /**
   * Creates a brand-new `RefreshToken` row (a fresh `familyId` when none is
   * given — i.e. a new login — or the same `familyId` continued, for a
   * rotation) and returns the raw opaque value to hand back to the client.
   */
  private async issueRefreshToken(
    userId: string,
    companyId: string | null,
    familyId: string = randomUUID(),
  ): Promise<string> {
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = await password.hash(secret);
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlMs);

    const row = await prisma.refreshToken.create({
      data: { userId, familyId, tokenHash, expiresAt },
    });

    const companySegment = companyId ?? '-';
    return `${row.id}.${companySegment}.${secret}`;
  }

  /** Signs a fresh access token and issues a refresh token alongside it (same family if `familyId` is given). */
  async issueTokenPair(
    claims: AccessTokenClaims,
    familyId?: string,
  ): Promise<TokenPair> {
    const accessToken = this.signAccessToken(claims);
    const refreshToken = await this.issueRefreshToken(
      claims.sub,
      claims.companyId,
      familyId,
    );
    return { accessToken, refreshToken };
  }

  private parseRawToken(
    raw: string,
  ): { id: string; companyId: string | null; secret: string } | null {
    const parts = raw.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [id, companySegment, secret] = parts;
    if (!id || !companySegment || !secret) {
      return null;
    }
    return {
      id,
      companyId: companySegment === '-' ? null : companySegment,
      secret,
    };
  }

  /**
   * WU-05 DoD item 4 / the critical design note on token family reuse
   * detection. Verifies the presented raw refresh token, and — if valid —
   * marks it used (one-time use, "rotating"). Does NOT itself issue a new
   * pair; `AuthService.refresh()` still needs to re-load the user (to
   * rebuild fresh `role`/`permissions`/`ver` claims and re-check
   * ACTIVE/suspended status) before minting the replacement, so this
   * returns just enough (`userId`, `companyId`, `familyId`) for the caller
   * to do that.
   *
   * Order of checks is deliberate:
   *   1. Parse + hash-verify (ownership) — anything else is `INVALID`.
   *   2. Expiry — a merely-stale token is not inherently suspicious (e.g. a
   *      device that sat unused for 61 days), so this alone doesn't revoke
   *      the family, just asks for a fresh login.
   *   3. `usedAt`/`revokedAt` (reuse) — checked on the token's *own* row,
   *      not only via a prior `usedAt`: a never-used sibling whose row was
   *      marked `revokedAt` by an earlier reuse event in the same family
   *      must also be rejected, per this work unit's design note. Only
   *      this branch revokes the whole family and reports `REUSED`.
   */
  async consumeRefreshToken(raw: string): Promise<ConsumeRefreshTokenResult> {
    const parsed = this.parseRawToken(raw);
    if (!parsed) {
      return { ok: false, reason: 'INVALID' };
    }

    const existing = await prisma.refreshToken.findUnique({
      where: { id: parsed.id },
    });
    if (!existing) {
      return { ok: false, reason: 'INVALID' };
    }

    const secretMatches = await password.verify(
      existing.tokenHash,
      parsed.secret,
    );
    if (!secretMatches) {
      return { ok: false, reason: 'INVALID' };
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      return { ok: false, reason: 'EXPIRED' };
    }

    if (existing.usedAt || existing.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { ok: false, reason: 'REUSED' };
    }

    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: { usedAt: new Date() },
    });

    return {
      ok: true,
      userId: existing.userId,
      companyId: parsed.companyId,
      familyId: existing.familyId,
    };
  }

  /**
   * WU-05 DoD item 5: revokes the presented refresh token. Idempotent and
   * deliberately silent about *why* nothing happened (malformed token,
   * unknown id, already revoked) — `POST /auth/logout` always returns
   * `204` per contracts/auth.md, with no error case documented, so there is
   * nothing useful (and potentially leaky) to distinguish here.
   */
  async revokeRefreshToken(raw: string): Promise<void> {
    const parsed = this.parseRawToken(raw);
    if (!parsed) {
      return;
    }

    await prisma.refreshToken.updateMany({
      where: { id: parsed.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

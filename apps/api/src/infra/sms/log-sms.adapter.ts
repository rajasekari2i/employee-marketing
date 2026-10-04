import { Injectable, Logger } from '@nestjs/common';

import type { SmsAdapter } from './sms-adapter.interface';

/**
 * User Story 4 (specs/001-company-user-auth/orchestration-plan.md),
 * decision #4 / DoD item 1. No real SMS gateway exists yet (research.md
 * #5) — this adapter logs the OTP at `debug` level only, for local
 * development, instead of sending anything over the network.
 *
 * **Load-bearing detail (decision #4)**: logs the already-composed
 * `message` STRING itself, never a structured `{ otp: code }` field.
 * `deep-redact.ts`'s `SENSITIVE_KEYS` set already includes `'otp'`
 * literally, and `app.module.ts`'s `LoggerModule.forRoot(...)` makes every
 * Nest `Logger` instance in this process pino-backed and therefore run
 * through `formatters.log`'s `deepRedact` — a naive
 * `this.logger.debug({ otp: code })` would log `otp: "[REDACTED]"`,
 * defeating the whole point of this adapter (seeing the code locally
 * without a real SMS bill). `deepRedact` only ever matches by object *key*,
 * never a substring inside an unrelated string value, so composing the
 * whole line as one string is what keeps the OTP visible here by
 * construction rather than by exploiting that known blind spot elsewhere.
 *
 * Also load-bearing: `debug` level specifically — never `info` or above
 * (this project's default `LOG_LEVEL`), and only in this one adapter, never
 * through the request-logging (pino-http) pipeline.
 */
@Injectable()
export class LogSmsAdapter implements SmsAdapter {
  private readonly logger = new Logger(LogSmsAdapter.name);

  async send(toE164: string, message: string): Promise<void> {
    this.logger.debug(`[LogSmsAdapter] -> ${toE164}: ${message}`);
    return Promise.resolve();
  }
}

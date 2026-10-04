/**
 * User Story 4 (specs/001-company-user-auth/orchestration-plan.md), DoD
 * item 1 / research.md #5. Mirrors the `StorageAdapter` interface-plus-
 * concrete-implementation pattern (`apps/api/src/infra/storage/
 * storage-adapter.interface.ts`) — every place in this codebase that sends
 * an OTP goes through this interface, never a raw HTTP call to a real SMS
 * gateway directly, so swapping `LogSmsAdapter` (this slice, local dev) for
 * a real gateway adapter (a later slice) is a configuration change to
 * whichever module provides `SmsAdapter`, not a rewrite of `AuthService`.
 */
export interface SmsAdapter {
  /** Sends `message` to `toE164` (an E.164-ish mobile number, not validated by this interface itself). */
  send(toE164: string, message: string): Promise<void>;
}

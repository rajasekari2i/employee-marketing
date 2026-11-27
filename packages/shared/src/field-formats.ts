// Reusable field-format validators for the human-typed master-data fields
// (person names, place names, phone, PIN code, username, money, dates).
// They live here rather than inline in `shops.schema.ts`/`users.schema.ts`
// because "One contract" (CLAUDE.md Constitution rule 5) has to hold across
// every door onto the same row — a shop can be created from the Company
// Admin's `ShopFormScreen` via `createShopSchema` OR the executive's
// field-create via `addExtraStopSchema`'s `newShop`, and a user's pay can be
// set from `createUserSchema` OR `salaryRateSchema` — and both the NestJS
// DTOs and the mobile forms derive from the same objects.
//
// The messages are the user-facing strings. The mobile forms render them
// verbatim under the offending input, and the API returns them in the
// problem-details body of a 400, so a client that skipped the local check
// still gets the same sentence.

import { z } from 'zod';

/**
 * Letters, spaces, and the three marks real names carry: `.` for initials
 * ("K. Ramasamy"), `'` for names like "D'Souza", `-` for double-barrelled
 * ones. Digits and every other symbol are rejected.
 *
 * Must start with a letter so a lone "." or "-" is not a name.
 */
const PERSON_NAME_PATTERN = /^[A-Za-z][A-Za-z .'-]*$/;

/**
 * As `PERSON_NAME_PATTERN`, plus `&` — because two of the places this
 * validates are literally spelled with one ("Jammu & Kashmir", "Dadra &
 * Nagar Haveli"), and rejecting a state the address actually has is a worse
 * failure than allowing one symbol.
 */
const PLACE_NAME_PATTERN = /^[A-Za-z][A-Za-z .'&-]*$/;

/**
 * Indian 10-digit subscriber number: first digit 6-9 (every mobile series
 * in the current numbering plan), nine more digits, nothing else — no `+91`
 * prefix, no leading 0, no spaces, hyphens or brackets, per the field rule
 * that symbols and letters are not accepted at all.
 */
const INDIAN_PHONE_PATTERN = /^[6-9][0-9]{9}$/;

/**
 * Indian PIN code: six digits, first 1-9 (a leading 0 is not a valid
 * postal circle), with the single space some people type after the third
 * digit ("600 001") tolerated on input — `indianPostalCodeSchema` strips it
 * so what gets stored is always the bare six digits.
 */
const INDIAN_POSTAL_CODE_PATTERN = /^[1-9][0-9]{2}\s?[0-9]{3}$/;

/**
 * A login handle. One pattern carries four of the five rules at once:
 *
 *   `[A-Za-z]`          must start with a letter — never a digit or symbol
 *   `[A-Za-z0-9]*`      letters/digits freely after it
 *   `(?:[._-][A-Za-z0-9]+)*`
 *                       a `.`, `_` or `-` is only legal when followed by at
 *                       least one letter/digit, which simultaneously bans a
 *                       trailing symbol ("user.") and consecutive ones
 *                       ("user..name", "user._name")
 *
 * Spaces are excluded by construction — there is no branch that admits one.
 * Length (3-20) is NOT in the pattern: it is a separate `.min()`/`.max()` so
 * "too short" and "wrong characters" can say different things.
 */
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

/**
 * Money as a decimal string (`contracts/users.md`: "decimal as string", so
 * no float ever touches a rupee figure). Digits, with at most two decimal
 * places — no `₹`, no thousands separators, no letters, no sign.
 */
const DECIMAL_AMOUNT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Aadhaar: 12 digits, first digit 2-9 — UIDAI never issues a number
 * starting 0 or 1, so a leading 0/1 is a typo, not an identity. The single
 * spaces the UI groups it with ("1234 5678 9012") are tolerated on input;
 * `aadhaarSchema` strips them so what is stored is always 12 bare digits.
 *
 * Deliberately NOT a Verhoeff checksum check. The last digit of a real
 * Aadhaar IS a Verhoeff check digit, and verifying it would catch most
 * single-digit typos — but it also rejects every placeholder and test
 * number, which is a worse failure for a field an admin may be filling in
 * from a photocopy. Say the word and it is a dozen lines here.
 */
const AADHAAR_PATTERN = /^[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}$/;

/** How the UI groups an Aadhaar number for reading: 4 + 4 + 4. */
const AADHAAR_GROUP_SIZE = 4;
export const AADHAAR_DIGIT_COUNT = 12;

/**
 * Regroups whatever has been typed so far into "1234 5678 9012".
 * Non-digits are dropped rather than rejected, and anything past the 12th
 * digit is discarded, so this is safe to run on every keystroke — the
 * field can never hold a value its own validator would refuse on length.
 *
 * Lives here, next to the pattern it mirrors, so the display grouping and
 * the accepted grouping cannot drift apart.
 */
export function formatAadhaar(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, AADHAAR_DIGIT_COUNT);
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += AADHAAR_GROUP_SIZE) {
    groups.push(digits.slice(i, i + AADHAAR_GROUP_SIZE));
  }
  return groups.join(' ');
}

/** `YYYY-MM-DD`. Shape only — `isoCalendarDateSchema` additionally checks the date exists. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Does `YYYY-MM-DD` name a day that actually exists? The pattern alone
 * happily accepts "2026-13-45" and "2025-02-30"; round-tripping through
 * `Date` and comparing back is what rejects them. UTC on purpose — a
 * calendar date has no timezone, and `new Date("2026-03-01")` parsed as
 * local time can slide to February in a negative-offset zone.
 */
function isRealCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  return new Date(timestamp).toISOString().slice(0, 10) === value;
}

export const FIELD_FORMAT_MESSAGES = {
  personName: 'Numbers and special characters are not allowed.',
  placeName: 'Numbers and special characters are not allowed.',
  phone: 'Enter a 10-digit Indian phone number starting with 6, 7, 8 or 9.',
  postalCode: 'Enter a valid 6-digit PIN code starting with 1-9.',
  radius: 'Visit radius must be a whole number of metres.',
  required: 'This field is required.',
  email: 'Enter a valid email address, like name@example.com.',
  usernameLength: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`,
  usernameFormat:
    'Username must start with a letter and use only letters, numbers, . _ or - (no spaces, and not two symbols in a row).',
  amount: 'Enter numbers only, with at most 2 decimal places.',
  isoDate: 'Enter a real date in YYYY-MM-DD format.',
  aadhaar: 'Enter a 12-digit Aadhaar number (digits only, starting 2-9).',
} as const;

/** A person's name — the shop owner. Trimmed, letters only (see the pattern above). */
export const personNameSchema = z
  .string()
  .trim()
  .min(1, FIELD_FORMAT_MESSAGES.required)
  .max(200)
  .regex(PERSON_NAME_PATTERN, FIELD_FORMAT_MESSAGES.personName);

/** A city or state name. Same rule as a person's name, plus `&`. */
export const placeNameSchema = z
  .string()
  .trim()
  .min(1, FIELD_FORMAT_MESSAGES.required)
  .max(100)
  .regex(PLACE_NAME_PATTERN, FIELD_FORMAT_MESSAGES.placeName);

/** A 10-digit Indian phone number, digits only. */
export const indianPhoneSchema = z
  .string()
  .trim()
  .regex(INDIAN_PHONE_PATTERN, FIELD_FORMAT_MESSAGES.phone);

/**
 * A 6-digit Indian PIN code. Accepts "600 001" on the way in and always
 * yields "600001" — normalising here rather than at each call site keeps
 * stored codes comparable (search, dedupe) regardless of how they were
 * typed, and means re-submitting an already-normalised value still passes.
 */
export const indianPostalCodeSchema = z
  .string()
  .trim()
  .regex(INDIAN_POSTAL_CODE_PATTERN, FIELD_FORMAT_MESSAGES.postalCode)
  .transform((value) => value.replace(/\s/g, ''));

/**
 * A radius in metres. `invalid_type_error` matters: the mobile form sends
 * `Number(text)`, so a typed "50m" arrives as `NaN` and the default Zod
 * message for that ("Expected number, received nan") is not something to
 * show a Company Admin.
 */
export const radiusMetersSchema = z
  .number({
    invalid_type_error: FIELD_FORMAT_MESSAGES.radius,
    required_error: FIELD_FORMAT_MESSAGES.radius,
  })
  .int(FIELD_FORMAT_MESSAGES.radius)
  .positive(FIELD_FORMAT_MESSAGES.radius);

/** An email address. `z.string().email()` does the work; this only replaces the default message. */
export const emailSchema = z
  .string()
  .trim()
  .max(200)
  .email(FIELD_FORMAT_MESSAGES.email);

/**
 * A login handle: 3-20 characters, starts with a letter, letters/digits/
 * `._-` only, never ending on a symbol, never two symbols in a row.
 *
 * Deliberately NOT applied to `loginSchema`'s `username`
 * (`auth.schema.ts`) — sign-in has to keep accepting whatever is already
 * stored, including handles created before this rule existed. This is a
 * rule about what may be *minted*, not about what may authenticate.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH, FIELD_FORMAT_MESSAGES.usernameLength)
  .max(USERNAME_MAX_LENGTH, FIELD_FORMAT_MESSAGES.usernameLength)
  .regex(USERNAME_PATTERN, FIELD_FORMAT_MESSAGES.usernameFormat);

/** A rupee figure as a decimal string — digits and at most 2 decimal places. */
export const decimalAmountSchema = z
  .string()
  .trim()
  .regex(DECIMAL_AMOUNT_PATTERN, FIELD_FORMAT_MESSAGES.amount);

/**
 * A 12-digit Aadhaar number. Accepts the grouped form the UI shows
 * ("1234 5678 9012") and always yields the bare digits, for the same
 * reason `indianPostalCodeSchema` normalises: one stored spelling, so a
 * lookup or a duplicate check never has to care how it was typed.
 */
export const aadhaarSchema = z
  .string()
  .trim()
  .regex(AADHAAR_PATTERN, FIELD_FORMAT_MESSAGES.aadhaar)
  .transform((value) => value.replace(/\s/g, ''));

/**
 * A calendar date, `YYYY-MM-DD`, that genuinely exists. The shape check and
 * the existence check carry the same message — to whoever typed it,
 * "2026-13-01" and "01/13/2026" are the same mistake.
 */
export const isoCalendarDateSchema = z
  .string()
  .trim()
  .regex(ISO_DATE_PATTERN, FIELD_FORMAT_MESSAGES.isoDate)
  .refine(isRealCalendarDate, FIELD_FORMAT_MESSAGES.isoDate);

/**
 * The same checks as the schemas above, as plain predicates, for the one
 * thing a Zod schema cannot do: tell the mobile form which field to put a
 * message under *before* the value has been coerced. `verificationRadius`
 * is the case that needs it — by the time Zod sees `NaN` the original text
 * ("50m") is gone, and "whole number of metres" is a better thing to say
 * about the text than about the `NaN`.
 */
export const FIELD_FORMAT_TESTS = {
  personName: (value: string): boolean => PERSON_NAME_PATTERN.test(value),
  placeName: (value: string): boolean => PLACE_NAME_PATTERN.test(value),
  phone: (value: string): boolean => INDIAN_PHONE_PATTERN.test(value),
  postalCode: (value: string): boolean =>
    INDIAN_POSTAL_CODE_PATTERN.test(value),
  /** Digits only — rejects "50m", "-5", "5.5" and "1e3" before `Number()` hides them. */
  radiusMeters: (value: string): boolean =>
    /^[0-9]+$/.test(value) && Number(value) > 0,
  email: (value: string): boolean => emailSchema.safeParse(value).success,
  /** Format only — length is reported separately so the two mistakes read differently. */
  usernameFormat: (value: string): boolean => USERNAME_PATTERN.test(value),
  usernameLength: (value: string): boolean =>
    value.length >= USERNAME_MIN_LENGTH && value.length <= USERNAME_MAX_LENGTH,
  amount: (value: string): boolean => DECIMAL_AMOUNT_PATTERN.test(value),
  isoDate: isRealCalendarDate,
  /** Accepts the grouped display form as well as bare digits. */
  aadhaar: (value: string): boolean => AADHAAR_PATTERN.test(value),
} as const;

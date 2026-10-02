# Quickstart: Validate Company Provisioning, User Management & Sign-In

This is a runnable walkthrough, not a test suite (CLAUDE.md's standing policy suspends unit/integration tests for now). It exercises every acceptance scenario in `spec.md` against the contracts in `contracts/`. Run it against a freshly migrated, freshly seeded database.

## Prerequisites

- API running locally with `DATABASE_URL` pointed at a dev Postgres and `SEED_SYSTEM_ADMIN_USERNAME` / `SEED_SYSTEM_ADMIN_PASSWORD` set.
- `pnpm --filter api prisma migrate deploy && pnpm --filter api prisma db seed` has run once (creates the first `SYSTEM_ADMIN`, per `research.md` #2).
- `LogSmsAdapter` active (non-production), so OTP codes land in the API's debug log instead of a real SMS.
- A shell with `curl` and `jq`. `API=http://localhost:3000/api/v1`.

## 1. System Admin provisions a company and its first Company Admin (User Story 1)

```sh
SA_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$SEED_SYSTEM_ADMIN_USERNAME\",\"password\":\"$SEED_SYSTEM_ADMIN_PASSWORD\"}" \
  | jq -r .accessToken)

curl -s -X POST "$API/companies" \
  -H "Authorization: Bearer $SA_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
        "code": "RAMANA",
        "name": "Sri Ramana Traders",
        "timezone": "Asia/Kolkata",
        "admin": {
          "name": "Ramana Admin",
          "username": "ramana.admin",
          "temporaryPassword": "ChangeMe1!",
          "mobile": "+919900011111"
        }
      }' | tee /tmp/company.json
```

**Expect**: `201`, a `company.code == "RAMANA"`, `admin.role == "COMPANY_ADMIN"` — this validates spec Acceptance Scenario 1.1–1.2.

Re-run the exact same `POST /companies` call with the **same** `Idempotency-Key` → expect the identical `201` body replayed, no second company. Re-run with a **different** key but the same `code` → expect `409 COMPANY_CODE_TAKEN` — validates Scenario 1.3.

## 2. Company Admin signs in and reaches Home (User Story 2)

```sh
CA_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"companyCode":"RAMANA","username":"ramana.admin","password":"ChangeMe1!"}' \
  | jq -r .accessToken)

curl -s "$API/me" -H "Authorization: Bearer $CA_TOKEN" | jq
```

**Expect**: `role == "COMPANY_ADMIN"`, `name == "Ramana Admin"` — the mobile Home screen (4.1) renders this `name` next to the avatar menu (Scenario 2.1).

Negative checks (Scenario 2.2–2.5):
- Wrong password → `401 INVALID_CREDENTIALS`.
- `PATCH /companies/:id {"status":"SUSPENDED"}` as System Admin, then retry the admin's login → `403 ACCOUNT_INACTIVE`. Reactivate afterwards (`"status":"ACTIVE"`) before continuing.
- 6 rapid wrong-password attempts for `ramana.admin`, then a 7th with the *correct* password → `429 RATE_LIMITED`.
- Attempt a login for any seeded `EMPLOYEE` user (none have a `username`, so no payload can succeed) → confirms FR-008 structurally rather than by a specific call.

```sh
curl -s -X POST "$API/auth/logout" -H "Authorization: Bearer $CA_TOKEN" \
  -d "{\"refreshToken\":\"$CA_REFRESH\"}" -H 'Content-Type: application/json'
# expect 204; a retried /auth/refresh with the same token now fails
```

## 3. Company Admin creates a user (User Story 3)

```sh
curl -s "$API/users" -H "Authorization: Bearer $CA_TOKEN" | jq '.items | length'
# expect 1 (just the admin so far)

curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $CA_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
        "name": "Vijay Manager",
        "role": "MANAGER",
        "username": "vijay.manager",
        "temporaryPassword": "ChangeMe1!",
        "mobile": "+919900022222",
        "monthlySalary": "25000",
        "halfDayRate": "600",
        "rateEffectiveFrom": "2026-10-01"
      }' | tee /tmp/user.json

curl -s "$API/users" -H "Authorization: Bearer $CA_TOKEN" | jq '.items | length'
# expect 2
```

**Expect**: Scenario 3.1–3.2 confirmed by the list growing to 2 and the new row carrying `role: MANAGER`.

Duplicate-username check (Scenario 3.4): repeat the same `POST /users` call with a fresh `Idempotency-Key` → expect `409 USERNAME_TAKEN`.

Employee-role check (Scenario 3.3): `POST /users` with `"role":"EMPLOYEE"` and **no** `username`/`temporaryPassword` → expect `201`. The same call **with** a `username` present → expect `400 VALIDATION_FAILED`.

Deactivation (Scenario 3.6): `PATCH /users/:id {"status":"INACTIVE"}` on the Manager just created, then attempt that Manager's login → expect `403 ACCOUNT_INACTIVE`; `GET /users/:id`-equivalent (via the list) still shows the row.

## 4. Profile and forgot-password (User Story 4)

```sh
curl -s "$API/me" -H "Authorization: Bearer $CA_TOKEN" | jq '{name, email}'
# both present; there is no PATCH that accepts name/email for the caller themself — only /me/photo and /auth/change-password exist

curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $CA_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"currentPassword":"ChangeMe1!","newPassword":"Better2day!","confirmPassword":"Better2day!"}'
# expect 204; the OLD access token's refresh counterpart is now revoked
```

Forgot-password end to end (Scenario 4.3–4.6), for the Manager created in step 3:

```sh
curl -s -X POST "$API/auth/forgot-password" -H 'Content-Type: application/json' \
  -d '{"username":"vijay.manager"}' | jq
# expect { "maskedMobile": "+91•••••••22222" } (shape only — check the running log for the dev OTP code)

RESET_TOKEN=$(curl -s -X POST "$API/auth/verify-otp" -H 'Content-Type: application/json' \
  -d '{"username":"vijay.manager","code":"<code from the debug log>"}' | jq -r .resetToken)

curl -s -X POST "$API/auth/reset-password" \
  -H "Authorization: Bearer $RESET_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"resetToken":"'"$RESET_TOKEN"'","newPassword":"FreshStart9!","confirmPassword":"FreshStart9!"}'
# expect 204
```

Then reactivate the Manager (`status: ACTIVE`) and confirm they can sign in with `FreshStart9!`.

Wrong-code and expiry checks: submit an incorrect 6-digit code → `400 OTP_INCORRECT` with `attemptsRemaining: 4`; wait 10+ minutes (or adjust the clock in a dev environment) and retry the last valid code → `410 OTP_EXPIRED`.

## 5. Tenant isolation spot-check (Edge Cases)

```sh
# Provision a second company the same way as step 1, with its own admin username
# that happens to match the first company's — e.g. "ramana.admin" again.
curl -s -X POST "$API/companies" -H "Authorization: Bearer $SA_TOKEN" ... \
  -d '{"code":"OTHERCO", "admin": {"username":"ramana.admin", ...}}'
# expect 201 — usernames repeat freely ACROSS companies (FR-006)

curl -s "$API/users" -H "Authorization: Bearer $CA_TOKEN" | jq '.items[].id'
# confirm this still lists only RAMANA's two users, never OTHERCO's
```

## Done when

Every numbered expectation above holds. That is this feature's acceptance bar until `009-visits-and-orders` and later slices add their own quickstarts on top of this one.

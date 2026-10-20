# Specification Quality Checklist: The Manager App

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Validation passed on the second iteration. Two `[NEEDS CLARIFICATION]` markers
were raised and **answered by the user on 2026-10-20**; both are recorded in the
spec under *Decisions taken with the user*. Neither had a defensible default —
the first is contradicted by the data model, the second by the design:

1. **FR-050 — a manager's data scope.** `02-PRD.md` FR-MGR-01 says the report
   defaults to "the manager's own team", but `schema.prisma`'s `User` has no
   `managerId` and there is no team model, so "own team" is unimplementable
   today. **Answered: the whole company.** Cheap to reverse — every screen
   already filters by executive, so a reporting line added later narrows them
   without changing their shape.

2. **FR-040 — the attendance roster.** **Answered: every active member of staff
   except the System Admin**, which pulled out a consequence worth stating
   rather than discovering: a manager appears on their own day sheet. FR-040a
   records it and why it is acceptable.

## This is by far the largest feature specified so far

It covers **eight boards** (3.1–3.8) where every previous slice covered one or
two, and spans what `03-ARCHITECTURE.md`'s own slice plan splits across three
(`010-extra-shops`, `011-attendance`, `012-manager-review`). The five user
stories are written to be independently deliverable precisely so it can be
built — and if wanted, split — along those lines:

| Story | Boards | Why it stands alone |
|---|---|---|
| US1 (P1) the previous-day report | 3.1 | The first manager screen that has ever existed; nothing else is reachable without it |
| US2 (P1) the visits list | 3.3 | Turns counts into rows; every tile on US1 leads here |
| US3 (P2) visit details and delivery | 3.4, 3.5, 3.6 | The only place a manager *acts* on a visit |
| US4 (P2) attendance | 3.7, 3.8 | A separate domain with its own records — **the natural split point** |
| US5 (P3) manager adds a shop | 3.2 | Occasional; executives can already add their own |

Carry into planning:

- **US4 needs a migration that nothing else here does.** `Attendance` is fully
  described in `03-ARCHITECTURE.md:669` — status, session, arrival time, derived
  lateness, payable units, versioned amendments — and **none of it exists in
  `schema.prisma`**. Three new enums, one model, append-only versioning and both
  tenant-isolation layers. US1–US3 and US5 need no schema change at all.
- **FR-046 and FR-047 are the pair to watch.** This feature deliberately shows a
  manager the measured distance, the range verdict and the quality flags —
  precisely what every prior slice worked to keep from executives. The two
  requirements state both halves so neither weakens the other, and SC-011 tests
  the executive's side is untouched.
- **There is no manager stack, bottom bar, or any manager screen today.** Managers
  currently land on the coming-soon screen; US1 creates the whole shell.
- **FR-035's lateness must be server-derived**, never accepted from the client —
  the same rule that governs visit distance, applied to a new domain.
- **Board 3.6 will render blank tiles in the current dev build** (`GOOGLE_MAPS_API_KEY`
  is empty, as slice 006 recorded). An environment gap, not a scope decision, but
  it will look like a defect at review if unknown.

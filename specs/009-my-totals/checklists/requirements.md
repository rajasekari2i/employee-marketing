# Specification Quality Checklist: My Totals — Executive

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

Validation passed on the second iteration. The first pass raised two
`[NEEDS CLARIFICATION]` markers — both because board 1.6 is a static mock whose
sample data quietly answers a question real data would reopen. **Both were put
to the user and answered on 2026-10-20**, and are recorded in the spec under
*Decisions taken with the user*:

1. **FR-020 — which days the weekly chart covers.** The board draws six columns
   labelled Mon–Sat. **Answered: Monday to Sunday, seven columns.** With six, an
   order recorded on a Sunday would be counted in the completion card, the tiles
   and the brand totals while being invisible in the chart — a silent
   inconsistency between two halves of one screen. Nothing in `01-BRD.md` or
   `02-PRD.md` fixes the week at six days, and `BeatPlan.workingDays` is
   configurable per plan.

2. **FR-015 — how many brands the section lists.** The board draws three rows in
   a fixed-height container with no scrolling region. **Answered: every brand,
   with the section scrolling.** This also makes the brand quantities reconcile
   exactly to the Total quantity tile (FR-015a) instead of being a subset of it.

Carry into planning:

- **This slice has TWO agreed divergences from its board**, not zero (007) and
  not one (008). FR-026 and SC-003 name both explicitly. They are
  correctness-driven — every colour, radius, font and spacing value remains the
  board's — and any *third* difference found at review is a defect, not a
  judgement call.
- **FR-016 resolves a contradiction in the product requirements**, not an
  ambiguity: FR-MY-04 says the period switcher recalculates everything shown,
  while FR-MY-05 and the design both say the chart is for the current week. The
  design settles it and FR-005 names the exception rather than leaving the
  contradiction standing.
- **FR-009's definition of "assigned" is load-bearing.** Counting only the beat
  plan's shops would let the completion ratio exceed 100% as soon as an extra
  shop is visited. Counting every stop on the day in both halves keeps it
  meaningful and matches what today's beat screen already counts.
- **FR-021 and FR-022 are the privacy and scope guards.** This screen aggregates
  the same visit rows the manager's reports will, and those carry distance,
  flags and review status; and `OD-07` keeps order *value* out of release 1
  entirely.

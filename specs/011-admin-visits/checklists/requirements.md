# Specification Quality Checklist: The Company Admin's Visits

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-22
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
- [ ] **Feature meets measurable outcomes defined in Success Criteria** — see below
- [x] No implementation details leak into specification

## Notes

**One box is deliberately unticked, and it is the honest result rather than a to-do.**

**SC-003** ("visually indistinguishable from its board… zero undocumented divergences") is **not met as built**. Two divergences exist on boards 4.2 and 4.3, both inherited from `010-manager-app` by sharing its implementation:

1. **The date / "All executives" / "All beats" filter chips on board 4.2 are not implemented.** Only the four tabs are. `GET /visits` already accepts `date`, `executiveId` and `beatPlanId`, so the gap is entirely in the screen.
2. **The previous/next order arrows on board 4.3 render disabled**, as `010` left them on 3.4.

They are *documented* divergences now — so the "zero **undocumented**" reading is satisfied — but SC-003's intent is a pixel match, and pretending the box is ticked would make this checklist useless for the next reader. **Fixing either fixes both the manager's board and the admin's**, which is the dividend of the shared implementation and the reason neither was worked around locally.

Everything else verified: SC-001, SC-002, SC-004 through SC-010 all hold.

## This specification was written after the implementation

Unique among slices `001`–`011`, and stated here as well as in the spec because it changes how this checklist should be read. The usual direction — spec, plan, tasks, implement — was not followed; the slice was built and merged first (commit `6039d11`), and these documents were written against the merged code and the design boards at the user's request.

What that means in practice:

- **Nothing here is a prediction.** Every requirement was checked against what shipped, which is why a divergence appears above instead of a plan to avoid one.
- **The risk this inverts is real.** A spec written afterwards tends to describe whatever was built and call it the requirement. The guard used was the **design file**, not the code: boards 4.2–4.5 were decoded and diffed against their Manager twins independently (research.md §2), and the two gaps that diff exposed are recorded as failures rather than absorbed into the requirements.

## Carry into any follow-up work

| Point | Why it matters |
|---|---|
| **The two stacks now share route names as a contract.** `OrderVisit`, `NoOrderVisit` and `OutOfRangeVisit` are registered in both the manager's and the admin's stack, and the three components type themselves against `ManagerStackParamList` in both. | Renaming one without its twin breaks the other, and the type error surfaces in a file that looks unrelated. Comments mark both registration sites; research.md §5 has the detail. |
| **`features/admin/` imports from `features/manager/`.** | Deliberate (research.md §4). If a later slice promotes the shared list to a neutral folder, it should move the detail screens too, or the direction becomes arbitrary rather than historical. |
| **The filter chips are one fix, not two.** | They belong in `visitsListShared.tsx`, where they land on boards 3.3 and 4.2 at once. Building them in either wrapper would re-create the drift the sharing exists to prevent. |
| **`POST /visits/:id/review` is still Manager-only.** | The admin's range detail is read-only by decision (FR-028), not by omission. Adjudicating exceptions is its own feature. |
| **Two routes the architecture marks "Manager, Admin" are still Manager-only in practice**: `GET /reports/previous-day` and the attendance pair. | Not oversights — no admin board reaches them yet. Whoever builds the admin's reports should expect the same three-line widening this slice used, and the same Scenario 7 check afterwards. |

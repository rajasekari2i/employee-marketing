# Specification Quality Checklist: My Visits — Executive

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
`[NEEDS CLARIFICATION]` markers — both genuine decisions rather than gaps in
analysis, because in each case the product requirements, the design and the
user's own instruction pointed different ways. **Both were put to the user and
answered on 2026-10-20**, and are recorded in the spec under *Decisions taken
with the user*:

1. **FR-020 — the opening date range.** `02-PRD.md` FR-MY-02 says the control
   "defaults to the last 7 days" and board 1.5 draws the button reading exactly
   that; the user asked for a screen that pages back through previous visits ten
   at a time, which a 7-day window would largely defeat. **Answered: all
   history**, with "Last 7 days" kept as a preset. This is a recorded departure
   from FR-MY-02's documented default — reversing it is a one-line change to
   FR-020, and nothing else in the spec depends on it.

2. **FR-026 — a visit still waiting to sync.** This screen is a read, and reads
   are never queued (`03-ARCHITECTURE.md:1016`), so a visit held in the device's
   outbox is not in the server's history and cannot be paged. Board 1.5 draws
   nothing for the case. **Answered: a waiting-count strip below the tabs**,
   reusing board 1.3's existing treatment and absent when nothing is waiting.

Carry into planning:

- **FR-026a is the single agreed divergence from board 1.5**, and FR-027/SC-004
  are written to say so explicitly. Unlike slice 007, this feature is therefore
  *not* a zero-divergence slice — but it is a one-divergence slice, and any
  second difference found at review is a defect, not a judgement call.
- **FR-022/FR-023 are the load-bearing privacy requirements.** This is the first
  executive-facing *list* of visits, and the same records drive the manager's
  list (design 3.3), which deliberately carries distance, flags and review
  status. The two views read the same rows, so the executive's response shape
  must be built so those fields are never selected, not merely dropped.
- **FR-007 is easy to get wrong and invisible when wrong.** A visit carries no
  business day of its own; the day it belongs to lives on the day's assignment.
  Deriving the grouping from any timestamp instead would misfile an offline
  visit that syncs across midnight.
- **FR-015 interacts with paging.** The tab counts describe the whole range in
  view, so they cannot be derived from the loaded pages.

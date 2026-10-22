# Specification Quality Checklist: Monthly Salary Run

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
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Validation passed on the second iteration. The first draft named the Prisma
models and the PDF library directly in the requirements; both were removed to
the planning phase, leaving the requirements about *what* is produced rather
than what produces it.

**Zero `[NEEDS CLARIFICATION]` markers were raised**, which is unusual and
deserves justification rather than being taken as a sign the feature is
simple. The user's description was unusually complete on exactly the points
that normally need asking — which statuses reduce pay, whether lateness
deducts, where the rate comes from, what finalising locks, and which screen
feeds the calculation. The three decisions that *were* open had defensible
answers in the product's existing rules rather than needing the user:

| Open point | Resolved by | Recorded as |
|---|---|---|
| A session the manager never marked | Neither paying nor silently dropping is acceptable — count zero, and surface it before locking | FR-017, FR-025 |
| Which people appear on the run | Slice `010` already settled the attendance roster; a different population would be inconsistent | FR-022 |
| Whether locking freezes attendance too | The product's amendment history exists to keep corrections possible; versioning is the established answer | FR-030, FR-032 |

## Carry into planning

| Point | Why it matters |
|---|---|
| **First migration since `010`.** `SalaryRun` and `SalaryRunLine` are fully designed in `03-ARCHITECTURE.md` and entirely unbuilt. Two new tenant tables means both isolation layers and the CI check that enforces them. | A new tenant table missing either layer must fail CI. |
| **PDF generation is a genuinely new capability.** Nothing in the product produces a PDF today. Where it is rendered — and therefore whether a new dependency lands on the device or the server — is a real decision, not a detail. | Affects the native build, the file-serving path, and whether the payslip can be produced offline. |
| **The CSV button on board 4.13 is the one known fidelity tension.** The board shows it; the spec puts CSV out of scope. Rendering it dead conflicts with FR-046, and omitting it conflicts with the board. | Needs an explicit decision, recorded, rather than a silent choice either way. |
| **The configured session start times do not match what the user described** (09:00/14:00 configured vs 10:00/15:30 described). No salary figure depends on them, but the lateness shown on the detail screen will be wrong until corrected. | A settings change, not code — but it will look like a bug at review. |
| **Reproducibility is the acceptance test, not a nice-to-have.** SC-005 and SC-006 are the ones BR-24 and the dispute risk hang on. | A month must reproduce exactly, twice, including across a mid-month rate change. |
| **The employee detail screen has no board.** FR-047 permits designing it, on the user's explicit instruction. | It is the only screen in the product without a reference, so it carries design risk the others do not. |

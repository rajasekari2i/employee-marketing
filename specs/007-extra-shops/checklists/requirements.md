# Specification Quality Checklist: Add Extra Shop — Executive

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-19
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

Validation passed on the first iteration. Specifics worth carrying into planning:

- **No `[NEEDS CLARIFICATION]` markers were raised.** The product documentation already specifies this feature in full (`FR-EXTRA-01` … `FR-EXTRA-09`, `BR-19`, `BUS-16`), and the one genuinely open question — whether to match the board's nearest-first distances given the previous feature's deliberate silence about location — was put to the user before the spec was written and answered "match the board". It is recorded under *Decisions taken with the user*, not as a clarification marker.

- **Three items are flagged for a decision rather than settled**, all in Assumptions. None blocks planning; each changes scope if answered differently:
  1. **OD-08** ("does an executive's extra shop need manager approval first?") is implemented as its documented default — immediate, no approval — but the business requirements still mark it *needs client confirmation*.
  2. **Offline adding is out of scope for this slice**, which is the single place this feature does not meet the product's "assume a bad network" rule. The reasoning is recorded in full under *Scope boundaries*.
  3. **Company auto-approval of executive-captured locations** reaches a second dead-end here: an executive can create a shop (FR-016–FR-018) and still be unable to record anything at it. Same recommendation as the previous feature — the pilot should enable auto-approval.

- **FR-021 is the load-bearing privacy requirement** and deserves explicit attention at review: this feature introduces a screen that shows an executive a distance, while the standing rule is that an executive never sees a *visit's* measured distance or range verdict. The two distances are different things and must not converge in the implementation — in particular the picker's read must not reuse the shape that carries a visit's measurement.

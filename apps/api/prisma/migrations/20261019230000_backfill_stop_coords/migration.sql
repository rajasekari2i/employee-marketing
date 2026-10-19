-- 006-visit-outcomes, FOUND LIVE: every visit submission was rejected with
-- SHOP_PIN_REQUIRED, even at shops with a perfectly good approved pin.
--
-- 20261019170000_visits added assignment_stops.shop_latitude/longitude — the
-- coordinate a visit is measured against, frozen at route creation
-- (research.md §4) — but added the columns WITHOUT backfilling the routes
-- that already existed. VisitsService.submitVisit treats a null stop
-- coordinate as "this shop has no approved location", so every stop
-- materialised before that migration refused outcomes forever.
--
-- The same omission was correctly avoided in 20261019093000_masters, whose
-- "Other" reason backfill covers exactly this class of problem. It was
-- simply missed here.
--
-- Backfills only where the shop's pin is APPROVED: a pending or missing pin
-- must still block an outcome, which is the rule this column enforces.
-- Written to be a correct no-op on a fresh database and idempotent if re-run.
UPDATE "assignment_stops" s
SET "shop_latitude"  = sh."latitude",
    "shop_longitude" = sh."longitude"
FROM "shops" sh
WHERE sh."id" = s."shop_id"
  AND sh."location_status" = 'APPROVED'
  AND sh."latitude" IS NOT NULL
  AND sh."longitude" IS NOT NULL
  AND s."shop_latitude" IS NULL;

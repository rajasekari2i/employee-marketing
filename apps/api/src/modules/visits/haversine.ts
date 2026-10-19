/**
 * Straight-line distance in metres — **the product's single distance
 * implementation** (CLAUDE.md Constitution rule 1: the server owns the
 * truth, and there is one place that decides what a distance is).
 *
 * Extracted here from `assignments.service.ts`, which computes the
 * nearest-shop line on the running beat card, so the visit critical path and
 * that feature cannot drift apart. The device never computes a distance for
 * any purpose, cosmetic or otherwise.
 */
const EARTH_RADIUS_METRES = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMetres(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.sqrt(a));
}

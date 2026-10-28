export type Store = { name: string; lat: number; lng: number };

/** Distance in meters between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Radius that counts as "in the store", allowing for GPS drift in a parking lot. */
export const ARRIVAL_RADIUS_M = 120;

export function nearestStore(pos: { lat: number; lng: number }, stores: Store[]): Store | null {
  let best: Store | null = null, bestD = Infinity;
  for (const s of stores) {
    const d = distanceM(pos, s);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best && bestD <= ARRIVAL_RADIUS_M ? best : null;
}

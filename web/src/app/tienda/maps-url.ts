/**
 * Reading and writing the maps link, kept apart from the picker component.
 *
 * Plain functions in a plain module: the component needs Angular's compiler to be
 * instantiated, and these are worth unit-testing without one.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A `?q=lat,lng` or `@lat,lng` link back into coordinates, so the pin can be restored. */
export function parseMapsUrl(url: string | undefined | null): LatLng | null {
  if (!url) return null;
  const match =
    /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url) ??
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * The link the customer receives.
 *
 * A google.com/maps `?q=` link rather than an OSM one: it opens in the maps app the
 * customer already has, on both phone platforms. Where the pin was *chosen* is our
 * business; where it *opens* is theirs.
 */
export function toMapsUrl(point: LatLng): string {
  return `https://www.google.com/maps?q=${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

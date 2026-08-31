import { describe, expect, it } from 'vitest';
import { parseMapsUrl, toMapsUrl } from './maps-url';

describe('toMapsUrl', () => {
  it('builds a link that opens in whatever maps app the customer has', () => {
    // google.com/maps ?q= rather than an OSM link: where the pin was chosen is our
    // business, where it opens is the customer's.
    expect(toMapsUrl({ lat: 10.487474, lng: -66.893349 })).toBe(
      'https://www.google.com/maps?q=10.487474,-66.893349',
    );
  });

  it('keeps six decimals — about 10cm, and stable to round-trip', () => {
    expect(toMapsUrl({ lat: 10.5, lng: -66 })).toBe(
      'https://www.google.com/maps?q=10.500000,-66.000000',
    );
  });
});

describe('parseMapsUrl', () => {
  it('round-trips its own output, so reopening returns to the same pin', () => {
    const point = { lat: 10.487474, lng: -66.893349 };
    expect(parseMapsUrl(toMapsUrl(point))).toEqual(point);
  });

  it('reads the two link shapes people actually paste', () => {
    expect(parseMapsUrl('https://www.google.com/maps?q=10.5,-66.9')).toEqual({
      lat: 10.5,
      lng: -66.9,
    });
    // The form you get from copying the browser's address bar in Google Maps.
    expect(parseMapsUrl('https://www.google.com/maps/@10.5,-66.9,17z')).toEqual({
      lat: 10.5,
      lng: -66.9,
    });
    expect(parseMapsUrl('https://maps.google.com/?ll=1&q=10.5,-66.9&z=17')).toEqual({
      lat: 10.5,
      lng: -66.9,
    });
  });

  it('returns null for a link with no coordinates in it, rather than a bogus pin', () => {
    // A short link cannot be resolved without following it, so the map opens at its
    // default view instead of dropping a marker in the wrong country.
    expect(parseMapsUrl('https://maps.app.goo.gl/abc123')).toBeNull();
    expect(parseMapsUrl('')).toBeNull();
    expect(parseMapsUrl(null)).toBeNull();
    expect(parseMapsUrl(undefined)).toBeNull();
    expect(parseMapsUrl('not a url at all')).toBeNull();
  });

  it('rejects coordinates that are not on Earth', () => {
    expect(parseMapsUrl('https://www.google.com/maps?q=91,-66')).toBeNull();
    expect(parseMapsUrl('https://www.google.com/maps?q=10,-181')).toBeNull();
  });
});

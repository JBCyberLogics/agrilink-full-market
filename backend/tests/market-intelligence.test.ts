import { describe, expect, it } from 'vitest';
import { deduplicateMarketObservations, marketObservationToApi } from '../src/services/market-intelligence.js';
import { parseKamisMarketHtml } from '../src/services/kamis-market-provider.js';

const now = Date.parse('2026-11-11T00:00:00.000Z');
const observation = (overrides: Record<string, unknown> = {}) => ({
  _id: 'observation-id', produce: 'Dry maize', market: 'Kibuye', county: 'Kisumu', price: 65,
  currency: 'KES', unit: 'Kg', observedAt: new Date('2026-11-10T00:00:00.000Z'),
  source: 'KAMIS', sourceReference: 'https://kamis.kilimo.go.ke/site/market/1280', verificationStatus: 'verified',
  ...overrides,
});

describe('market observation integrity', () => {
  it('preserves facts and provenance and normalizes a supported unit', () => {
    expect(marketObservationToApi(observation(), now)).toMatchObject({
      produce: 'Dry maize', market: 'Kibuye', location: 'Kisumu', price: 65,
      currency: 'KES', unit: 'kg', source: 'KAMIS', freshness: 'current', verificationStatus: 'verified',
    });
  });

  it.each([
    ['missing price', { price: undefined }], ['zero price', { price: 0 }], ['negative price', { price: -1 }],
    ['missing currency', { currency: undefined }], ['unsupported unit', { unit: 'basket-ish' }],
    ['missing provenance', { source: undefined }], ['future observation', { observedAt: new Date(now + 1) }],
    ['unverified observation', { verificationStatus: 'pending' }], ['demo observation', { isDemo: true }],
  ])('rejects %s instead of supplying a default', (_name, overrides) => {
    expect(marketObservationToApi(observation(overrides), now)).toBeNull();
  });

  it('marks older observations stale and removes exact duplicates', () => {
    const stale = marketObservationToApi(observation({ observedAt: new Date('2026-11-01T00:00:00.000Z') }), now);
    expect(stale?.freshness).toBe('stale');
    expect(deduplicateMarketObservations([stale!, stale!])).toHaveLength(1);
  });

  it('parses KAMIS wholesale and retail quotes separately with source date precision', () => {
    const html = `<table><tr><th>Market</th><th>Commodity</th><th>Classification</th><th>Grade</th><th>Sex</th><th>Wholesale</th><th>Retail</th><th>Supply Volume</th><th>County</th><th>Date</th></tr>
      <tr><td>Kibuye</td><td>Dry Maize</td><td>White Maize</td><td>-</td><td>-</td><td>65.00/Kg</td><td>65.00/Kg</td><td>900.00</td><td>Kisumu</td><td>2026-11-11</td></tr>
      <tr><td>Kibuye</td><td>Eggs</td><td>-</td><td>-</td><td>-</td><td>350.00/Tray(30)</td><td>-</td><td></td><td>Kisumu</td><td>2026-11-11</td></tr>
      <tr><td>Kibuye</td><td>Future Crop</td><td>-</td><td>-</td><td>-</td><td>10.00/Kg</td><td>11.00/Kg</td><td></td><td>Kisumu</td><td>2026-11-12</td></tr>
      <tr><td>Kibuye</td><td>Unsupported Crop</td><td>-</td><td>-</td><td>-</td><td>20.00/Basket</td><td>-</td><td></td><td>Kisumu</td><td>2026-11-11</td></tr></table>`;
    const result = parseKamisMarketHtml(html, Date.parse('2026-11-11T12:00:00+03:00'));
    expect(result.rowsSeen).toBe(4);
    expect(result.quoteSlotsSeen).toBe(8);
    expect(result.quotesUnavailable).toBe(2);
    expect(result.quotesRejected).toBe(3);
    expect(result.observations).toHaveLength(3);
    expect(result.observations.slice(0, 2).map((row) => row.priceType)).toEqual(['wholesale', 'retail']);
    expect(result.observations[0]).toMatchObject({ produce: 'Dry Maize (White Maize)', currency: 'KES', unit: 'kg', observationDate: '2026-11-11', observationTimePrecision: 'date', verificationMethod: 'official-provider' });
    expect(result.observations[2]).toMatchObject({ produce: 'Eggs', unit: 'tray-30-eggs', unitLabel: 'Tray(30)', priceType: 'wholesale' });
  });

  it('rejects a changed KAMIS table layout instead of publishing guessed columns', () => {
    expect(() => parseKamisMarketHtml('<table><tr><th>Updated</th></tr><tr><td>2026-11-11</td></tr></table>')).toThrow(/no longer matches/i);
  });
});

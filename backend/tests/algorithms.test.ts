import { describe, expect, it } from 'vitest';
import { calculateNetProfit, normalizeMatchingWeights, scoreMatch } from '../src/common/algorithms.js';
import { priceCentsOf, stockFieldOf, stockOf } from '../src/services/marketplace.js';

describe('deterministic agricultural calculations', () => {
  it('calculates revenue, costs, net profit, margin and target prices from supplied figures', () => {
    expect(calculateNetProfit({
      expectedSellingPrice: 100, sellableQuantity: 10, productionCost: 400,
      harvestCost: 100, packagingCost: 50, transportAndSellingCost: 50,
      otherCost: 0, targetProfit: 200,
    })).toMatchObject({ revenue: 1000, totalCosts: 600, netProfit: 400, profitMargin: 40, breakEvenPrice: 60, targetSellingPrice: 80, estimate: true });
  });
  it('rejects zero quantity and negative costs', () => {
    expect(() => calculateNetProfit({ expectedSellingPrice: 10, sellableQuantity: 0, productionCost: -1 })).toThrow();
  });
  it('requires normalized matching weights and complete factors', () => {
    const weights = normalizeMatchingWeights({ price: 0.35, quality: 0.25, distance: 0.2, availability: 0.2 });
    expect(scoreMatch({ price: 1, quality: 0.8, distance: 0.5, availability: 1 }, weights).score).toBeCloseTo(0.85);
    expect(() => normalizeMatchingWeights({ price: 0.5, quality: 0.5, distance: 0.5, availability: 0.5 })).toThrow();
    expect(() => scoreMatch({ price: 1 }, weights)).toThrow();
  });
});

describe('legacy inventory field compatibility', () => {
  it('uses the first valid stock field without mistaking zero for missing', () => {
    expect(stockFieldOf({ quantityAvailable: 0, stock: 8 })).toBe('quantityAvailable');
    expect(stockOf({ quantityAvailable: 0, stock: 8 })).toBe(0);
    expect(stockFieldOf({ availableStock: null, stock: '4' })).toBe('stock');
  });

  it('does not infer stock when no supported field is present', () => {
    expect(stockFieldOf({})).toBeNull();
    expect(stockOf({})).toBeNull();
  });
});

describe('listing price integrity', () => {
  it('accepts a real positive amount and converts major units to cents', () => {
    expect(priceCentsOf({ priceCents: 1250 })).toBe(1250);
    expect(priceCentsOf({ pricePerUnit: 12.5 })).toBe(1250);
  });

  it('rejects absent, zero, negative and sub-cent listing prices', () => {
    for (const product of [{}, { priceCents: 0 }, { price: 0 }, { pricePerUnit: -1 }, { price: 0.001 }]) {
      expect(() => priceCentsOf(product)).toThrow(/valid price/i);
    }
  });
});

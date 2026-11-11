import { z } from 'zod';
import { HttpError } from './http.js';

const profitSchema = z.object({
  expectedSellingPrice: z.number().finite().nonnegative().optional(),
  unitSalePrice: z.number().finite().nonnegative().optional(),
  sellableQuantity: z.number().finite().positive().optional(),
  quantity: z.number().finite().positive().optional(),
  productionCost: z.number().finite().nonnegative().default(0),
  harvestCost: z.number().finite().nonnegative().default(0),
  packagingCost: z.number().finite().nonnegative().default(0),
  transportAndSellingCost: z.number().finite().nonnegative().default(0),
  otherCost: z.number().finite().nonnegative().default(0),
  costs: z.array(z.object({ label: z.string().max(120).optional(), amount: z.number().finite().nonnegative() })).optional(),
  costsComplete: z.boolean().optional(),
  targetProfit: z.number().finite().nonnegative().optional().default(0),
}).refine((value) => (value.expectedSellingPrice ?? value.unitSalePrice ?? -1) >= 0, { message: 'Expected sale price must be non-negative.' })
  .refine((value) => (value.sellableQuantity ?? value.quantity ?? 0) > 0, { message: 'Sellable quantity must be positive.' });

export function calculateNetProfit(input: unknown) {
  const parsed = profitSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, 'Enter valid positive quantity and price values and non-negative costs.', 'INVALID_PROFIT_INPUT');
  const values = parsed.data;
  if (values.costs && values.costsComplete === false) throw new HttpError(422, 'Confirm all cost inputs before requesting a net profit estimate.', 'COSTS_INCOMPLETE');
  const quantity = values.sellableQuantity ?? values.quantity!;
  const sellingPrice = values.expectedSellingPrice ?? values.unitSalePrice!;
  const revenue = sellingPrice * quantity;
  const itemizedCosts = values.costs?.reduce((sum, cost) => sum + cost.amount, 0) ?? 0;
  const categorizedCosts = values.productionCost + values.harvestCost + values.packagingCost + values.transportAndSellingCost + values.otherCost;
  const costs = itemizedCosts + categorizedCosts;
  const netProfit = revenue - costs;
  return {
    revenue, totalCosts: costs, netProfit,
    profitMargin: revenue > 0 ? (netProfit / revenue) * 100 : null,
    breakEvenPrice: costs / quantity,
    targetSellingPrice: (costs + values.targetProfit) / quantity,
    currency: 'KES', estimate: true, source: 'user-provided inputs',
  };
}

const weightsSchema = z.object({
  price: z.number().min(0).max(1),
  quality: z.number().min(0).max(1),
  distance: z.number().min(0).max(1),
  availability: z.number().min(0).max(1),
}).refine((values) => Math.abs(values.price + values.quality + values.distance + values.availability - 1) < 0.000001, {
  message: 'Weights must sum to 1.',
});

export function normalizeMatchingWeights(input: unknown) {
  const parsed = weightsSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, 'Matching weights must be between 0 and 1 and sum to 1.', 'INVALID_MATCHING_WEIGHTS');
  return parsed.data;
}

export function scoreMatch(factors: { price?: number; quality?: number; distance?: number; availability?: number }, weights: { price: number; quality: number; distance: number; availability: number }) {
  const names = ['price', 'quality', 'distance', 'availability'] as const;
  const missing = names.filter((name) => typeof factors[name] !== 'number' || !Number.isFinite(factors[name]));
  if (missing.length) throw new HttpError(422, 'Matching requires verified values for every factor.', 'MATCH_DATA_INCOMPLETE', undefined, { missing });
  const score = names.reduce((sum, name) => sum + (factors[name] as number) * weights[name], 0);
  return { score, weights, factors, method: 'weighted-deterministic-score' };
}

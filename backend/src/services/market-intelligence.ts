import { createHash } from 'node:crypto';

const supportedUnits = new Map<string, string>([
  ['kg', 'kg'], ['kgs', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
  ['g', 'g'], ['gram', 'g'], ['grams', 'g'],
  ['tonne', 'tonne'], ['tonnes', 'tonne'], ['metric tonne', 'tonne'], ['metric tonnes', 'tonne'],
  ['l', 'l'], ['litre', 'l'], ['litres', 'l'], ['liter', 'l'], ['liters', 'l'],
  ['piece', 'piece'], ['pieces', 'piece'], ['unit', 'piece'], ['units', 'piece'],
  ['lt', 'l'], ['liter', 'l'],
  ['bunch', 'bunch'], ['bunches', 'bunch'], ['crate', 'crate'], ['crates', 'crate'],
  ['bag', 'bag'], ['bags', 'bag'], ['sack', 'sack'], ['sacks', 'sack'],
  ['tray', 'tray'], ['trays', 'tray'], ['tray(30)', 'tray-30-eggs'], ['tray (30)', 'tray-30-eggs'],
  ['tray-30-eggs', 'tray-30-eggs'], ['head', 'head'], ['heads', 'head'],
]);

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

export function normalizeMarketUnit(value: unknown) {
  const raw = text(value);
  return raw ? supportedUnits.get(raw.toLowerCase()) ?? null : null;
}

export function marketObservationFingerprint(input: { produce: string; market: string; location: string; price: number; currency: string; unit: string; observedAt: Date | string; source: string; sourceReference?: string | null; priceType?: string | null }) {
  const identity = [input.produce, input.market, input.location, input.price, input.currency, input.unit, new Date(input.observedAt).toISOString(), input.source, input.sourceReference ?? '', input.priceType ?? '']
    .map((value) => String(value).trim().toLowerCase());
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function verifiedMarketObservationQuery(now = new Date()) {
  const unitPattern = /^(kg|kgs|kilograms?|g|grams?|tonnes?|metric tonnes?|l|lt|litres?|liters?|pieces?|units?|bunches?|crates?|bags?|sacks?|trays?|tray-30-eggs|heads?)$/i;
  return {$and:[
    {isDemo:{$ne:true}},{verificationStatus:'verified'},{observedAt:{$type:'date',$lte:now}},{price:{$type:'number',$gt:0}},{currency:{$regex:/^[A-Z]{3}$/}},
    {$or:[{produce:{$type:'string',$ne:''}},{crop:{$type:'string',$ne:''}}]},{$or:[{market:{$type:'string',$ne:''}}]},
    {$or:[{county:{$type:'string',$ne:''}},{location:{$type:'string',$ne:''}}]},
    {$or:[{unit:{$type:'string',$regex:unitPattern}},{measurementUnit:{$type:'string',$regex:unitPattern}}]},
    {$or:[{source:{$type:'string',$ne:''}},{sourceName:{$type:'string',$ne:''}},{provider:{$type:'string',$ne:''}}]},
  ]};
}

/** Convert a stored observation only when all required facts and provenance exist. */
export function marketObservationToApi(row: any, now = Date.now()) {
  if (!row || row.isDemo === true || row.verificationStatus !== 'verified') return null;
  const produce = text(row.produce) ?? text(row.crop);
  const market = text(row.market);
  const location = text(row.location) ?? text(row.county);
  const source = text(row.sourceName) ?? text(row.source) ?? text(row.provider);
  const sourceReference = text(row.sourceReference) ?? text(row.sourceUrl) ?? null;
  const unit = normalizeMarketUnit(row.unit ?? row.measurementUnit);
  const priceType = row.priceType === 'wholesale' || row.priceType === 'retail' ? row.priceType : null;
  const unitLabel = text(row.unitLabel) ?? (unit === 'tray-30-eggs' ? 'Tray (30 eggs)' : unit);
  const currency = text(row.currency);
  const price = typeof row.price === 'number' ? row.price : Number(row.price);
  const observedAt = row.observedAt instanceof Date ? row.observedAt : new Date(row.observedAt);
  const timestamp = observedAt.getTime();
  if (!produce || !market || !location || !source || !unit || !currency || !/^[A-Z]{3}$/.test(currency)
    || !Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp) || timestamp > now) return null;
  const ageMs = now - timestamp;
  return {
    id: String(row._id ?? row.id ?? ''),
    produce,
    market,
    location,
    county: text(row.county),
    price,
    currency,
    unit,
    unitLabel,
    priceType,
    observationDate: text(row.observationDate),
    observationTimePrecision: row.observationTimePrecision === 'date' ? 'date' as const : 'instant' as const,
    observedAt: row.observationTimePrecision === 'date' && text(row.observationDate) ? text(row.observationDate) : observedAt.toISOString(),
    source,
    sourceReference,
    verificationStatus: 'verified' as const,
    freshness: ageMs <= 7 * 24 * 60 * 60 * 1000 ? 'current' as const : 'stale' as const,
  };
}

export function deduplicateMarketObservations<T extends { produce: string; market: string; location: string; price: number; currency: string; unit: string; observedAt: string; source: string; sourceReference: string | null; priceType?: string | null }>(rows: T[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [row.produce, row.market, row.location, row.price, row.currency, row.unit, row.observedAt, row.source, row.sourceReference ?? '', row.priceType ?? '']
      .map((value) => String(value).trim().toLowerCase()).join('\u001f');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


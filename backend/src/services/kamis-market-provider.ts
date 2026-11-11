import { DomUtils, parseDocument } from 'htmlparser2';
import { normalizeMarketUnit } from './market-intelligence.js';

export const KAMIS_SOURCE_NAME = 'KAMIS';
export const KAMIS_MARKET_PAGE = 'https://kamis.kilimo.go.ke/site/market_search';
export const KAMIS_SOURCE_REFERENCE = `${KAMIS_MARKET_PAGE}?per_page=3000`;
const KAMIS_FETCH_URL = KAMIS_SOURCE_REFERENCE;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 3000;

export type KamisPriceType = 'wholesale' | 'retail';
export type KamisObservation = {
  produce: string;
  market: string;
  location: string;
  price: number;
  currency: 'KES';
  unit: string;
  unitLabel: string;
  priceType: KamisPriceType;
  observedAt: Date;
  observationDate: string;
  observationTimePrecision: 'date';
  source: typeof KAMIS_SOURCE_NAME;
  sourceName: typeof KAMIS_SOURCE_NAME;
  sourceReference: typeof KAMIS_SOURCE_REFERENCE;
  verificationStatus: 'verified';
  verificationMethod: 'official-provider';
  isDemo: false;
};

export type KamisParseResult = {
  observations: KamisObservation[];
  rowsSeen: number;
  quoteSlotsSeen: number;
  quotesUnavailable: number;
  quotesRejected: number;
};

const normalizedHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedCell = (value: string) => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

function directCellText(node: any) {
  return normalizedCell(DomUtils.textContent(node));
}

function sourceDate(value: string, now: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000+03:00`);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now) return null;
  const expected = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (expected.getUTCFullYear() !== Number(year) || expected.getUTCMonth() !== Number(month) - 1 || expected.getUTCDate() !== Number(day)) return null;
  return date;
}

function parsePrice(value: string) {
  const raw = normalizedCell(value);
  if (!raw || /^[-–—n/a]+$/i.test(raw)) return { state: 'unavailable' as const };
  const match = /^(?:(KES|KSh)\s*)?([\d,]+(?:\.\d{1,4})?)\s*\/\s*([\p{L}][\p{L}\s()0-9-]*)$/iu.exec(raw);
  if (!match) return { state: 'rejected' as const };
  const currencyToken = match[1];
  const amountText = match[2];
  const sourceUnit = match[3];
  if (!amountText || !sourceUnit) return { state: 'rejected' as const };
  if (currencyToken && !/^(KES|KSh)$/i.test(currencyToken)) return { state: 'rejected' as const };
  const amount = Number(amountText.replace(/,/g, ''));
  const unitLabel = normalizedCell(sourceUnit);
  const unit = normalizeMarketUnit(unitLabel);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000 || !unit) return { state: 'rejected' as const };
  return { state: 'valid' as const, price: amount, unit, unitLabel };
}

function cleanAttribute(value: string) {
  const cleaned = normalizedCell(value);
  return !cleaned || /^[-–—]$/.test(cleaned) ? null : cleaned;
}

/** Parse the actual public market-search table; never infer missing quote fields. */
export function parseKamisMarketHtml(html: string, now = Date.now()): KamisParseResult {
  const document: any = parseDocument(html, { decodeEntities: true });
  const tables = DomUtils.findAll((node: any) => node.type === 'tag' && node.name === 'table', document.children);
  let dataRows: any[] | null = null;
  let columns: Map<string, number> | null = null;

  for (const table of tables) {
    const rows = DomUtils.findAll((node: any) => node.type === 'tag' && node.name === 'tr', [table]);
    if (!rows.length) continue;
    const headerRow = rows[0];
    if (!headerRow) continue;
    const cells = headerRow.children.filter((node: any) => node.type === 'tag' && ['th', 'td'].includes(node.name));
    const headers = cells.map((cell: any) => normalizedHeader(directCellText(cell)));
    const indexes = new Map(headers.map((header: string, index: number) => [header, index]));
    if (['market', 'commodity', 'wholesale', 'retail', 'county', 'date'].every((key) => indexes.has(key))) {
      dataRows = rows.slice(1);
      columns = indexes;
      break;
    }
  }

  if (!dataRows || !columns) throw new Error('The KAMIS market table no longer matches its documented columns.');
  if (dataRows.length > MAX_ROWS) throw new Error(`KAMIS returned more than ${MAX_ROWS} records; refusing an unexpected response size.`);

  const observations: KamisObservation[] = [];
  let quotesUnavailable = 0;
  let quotesRejected = 0;
  let quoteSlotsSeen = 0;
  const cell = (row: any, key: string) => {
    const index = columns!.get(key);
    const nodes = row.children.filter((node: any) => node.type === 'tag' && ['th', 'td'].includes(node.name));
    return index === undefined || index >= nodes.length ? '' : directCellText(nodes[index]);
  };

  for (const row of dataRows) {
    const cells = row.children.filter((node: any) => node.type === 'tag' && ['th', 'td'].includes(node.name));
    if (!cells.length) continue;
    quoteSlotsSeen += 2;
    const market = cell(row, 'market');
    const commodity = cell(row, 'commodity');
    const location = cell(row, 'county');
    const observedAt = sourceDate(cell(row, 'date'), now);
    const classification = cleanAttribute(cell(row, 'classification'));
    const grade = cleanAttribute(cell(row, 'grade'));
    const sex = cleanAttribute(cell(row, 'sex'));
    if (!market || !commodity || !location || !observedAt) {
      quotesRejected += 2;
      continue;
    }
    const qualifiers = [classification, grade, sex].filter(Boolean);
    const produce = qualifiers.length ? `${commodity} (${qualifiers.join('; ')})` : commodity;
    if (produce.length > 120 || market.length > 120 || location.length > 120) {
      quotesRejected += 2;
      continue;
    }
    for (const [priceType, key] of [['wholesale', 'wholesale'], ['retail', 'retail']] as const) {
      const quote = parsePrice(cell(row, key));
      if (quote.state === 'unavailable') { quotesUnavailable += 1; continue; }
      if (quote.state === 'rejected') { quotesRejected += 1; continue; }
      observations.push({
        produce, market, location, price: quote.price,
        // KAMIS is the Kenya Ministry of Agriculture market system. Its public
        // market export omits a currency column; its official market material
        // labels KAMIS price summaries in KES. This explicit provider mapping
        // is kept here, with source provenance, rather than a generic fallback.
        currency: 'KES', unit: quote.unit, unitLabel: quote.unitLabel, priceType,
        observedAt, observationDate: cell(row, 'date'), observationTimePrecision: 'date',
        source: KAMIS_SOURCE_NAME, sourceName: KAMIS_SOURCE_NAME, sourceReference: KAMIS_SOURCE_REFERENCE,
        verificationStatus: 'verified', verificationMethod: 'official-provider', isDemo: false,
      });
    }
  }
  return { observations, rowsSeen: dataRows.length, quoteSlotsSeen, quotesUnavailable, quotesRejected };
}

async function readBoundedText(response: Response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) { await response.body?.cancel().catch(() => undefined); throw new Error('KAMIS response exceeded the configured size limit.'); }
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error('KAMIS response exceeded the configured size limit.');
    return new TextDecoder().decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('KAMIS response exceeded the configured size limit.');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

/** Fetch KAMIS's publicly available search table with bounded time and size. */
export async function fetchKamisMarketObservations(fetchImpl: typeof fetch = fetch, now = Date.now()) {
  const response = await fetchImpl(KAMIS_FETCH_URL, {
    headers: { Accept: 'text/html', 'User-Agent': 'AgriLink market-source importer/1.0' },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) { await response.body?.cancel().catch(() => undefined); throw new Error(`KAMIS returned HTTP ${response.status}.`); }
  const finalUrl = new URL(response.url || KAMIS_FETCH_URL);
  if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== 'kamis.kilimo.go.ke') { await response.body?.cancel().catch(() => undefined); throw new Error('KAMIS redirected outside its trusted HTTPS host.'); }
  if (!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) { await response.body?.cancel().catch(() => undefined); throw new Error('KAMIS returned an unexpected content type.'); }
  const html = await readBoundedText(response);
  if (!html.trim()) throw new Error('KAMIS returned an empty market table.');
  return parseKamisMarketHtml(html, now);
}

import { fetchKamisMarketObservations, KAMIS_SOURCE_REFERENCE, KAMIS_SOURCE_NAME } from '../src/services/kamis-market-provider.js';

const result = await fetchKamisMarketObservations();
if (!result.rowsSeen || !result.observations.length) {
  throw new Error('The live KAMIS source returned no usable observations; no data was written.');
}
const dates = result.observations.map((row) => row.observationDate).sort();
console.log(JSON.stringify({
  provider: KAMIS_SOURCE_NAME,
  sourceReference: KAMIS_SOURCE_REFERENCE,
  rowsSeen: result.rowsSeen,
  quoteSlotsSeen: result.quoteSlotsSeen,
  usableQuotes: result.observations.length,
  unavailableQuotes: result.quotesUnavailable,
  rejectedQuotes: result.quotesRejected,
  newestObservationDate: dates.at(-1) ?? null,
  oldestObservationDate: dates[0] ?? null,
  persistence: 'read-only verification; no database writes',
}));

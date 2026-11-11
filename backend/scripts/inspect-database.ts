import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Set MONGODB_URI in the backend secret store before running the read-only inspection.');

const sensitive = /password|secret|token|credential|private|salt|key/i;
const reference = /(^|_)(id|user|owner|farmer|seller|buyer|customer|order|product|category|conversation|actor|reporter|payment|shop)(s|id)?$/i;
function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return 'date';
  if (value instanceof mongoose.Types.ObjectId) return 'objectId';
  if (Array.isArray(value)) return 'array';
  if (Buffer.isBuffer(value)) return 'binary';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

try {
  await connectDatabase(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection did not expose a database handle.');
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const report = [];
  for (const collectionInfo of collections) {
    const collection = db.collection(collectionInfo.name);
    const [count, indexes, samples] = await Promise.all([
      collection.estimatedDocumentCount(), collection.indexes(), collection.find({}).limit(100).toArray(),
    ]);
    const fields = new Map<string, { types: Set<string>; present: number; reference: boolean; sensitive: boolean }>();
    for (const doc of samples) {
      for (const [key, value] of Object.entries(doc)) {
        const field = fields.get(key) ?? { types: new Set<string>(), present: 0, reference: reference.test(key), sensitive: sensitive.test(key) };
        field.types.add(typeOf(value)); field.present++; fields.set(key, field);
      }
    }
    report.push({
      collection: collectionInfo.name,
      estimatedDocuments: count,
      sampleSize: samples.length,
      fields: [...fields.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => ({
        name, sampleTypes: [...item.types].sort(), presentInSample: item.present,
        missingInSample: samples.length - item.present,
        possibleReferenceField: item.reference,
        sensitiveFieldName: item.sensitive,
      })),
      indexes: indexes.map((index) => ({ name: index.name, keys: index.key, unique: index.unique === true, sparse: index.sparse === true, expireAfterSeconds: index.expireAfterSeconds ?? null })),
    });
  }
  console.log(JSON.stringify({ database: db.databaseName, connection: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', mode: 'read-only', collections: report }, null, 2));
} finally {
  await disconnectDatabase();
}

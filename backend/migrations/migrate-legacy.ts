import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';

if (!process.argv.includes('--dry-run')) {
  throw new Error('This migration utility is read-only. No production migration is enabled. Pass --dry-run to inspect legacy documents.');
}
const uri = process.env.MONGODB_MIGRATION_URI;
if (!uri) throw new Error('Set MONGODB_MIGRATION_URI to an isolated, backed-up migration copy. Production MONGODB_URI is not accepted.');
const parsedUri = new URL(uri);
const dbName = decodeURIComponent(parsedUri.pathname.replace(/^\//, '').split('/')[0] ?? '');
if (!dbName.endsWith('_migration') && !dbName.endsWith('_test')) {
  throw new Error('Dry-run migration requires a database name ending in _migration or _test.');
}

const canonicalHints: Record<string, Record<string, string[]>> = {
  users: { displayName: ['fullName', 'name', 'firstName', 'lastName'], passwordHash: ['passwordHash', 'password'], role: ['role', 'userType', 'accountType'] },
  products: { owner: ['farmer', 'sellerId', 'seller', 'user'], price: ['priceCents', 'price', 'pricePerUnit'], stock: ['availableStock', 'quantityAvailable', 'stock', 'quantity'] },
  orders: { buyer: ['buyer', 'customerId'], farmer: ['farmer', 'sellerId'], items: ['items', 'productList'], total: ['totalCents', 'totalAmount'] },
  payments: { order: ['order', 'orderId'], payer: ['payer', 'userId'], amount: ['amountCents', 'amount'], status: ['status', 'paymentStatus'] },
  notifications: { user: ['user', 'userId'], readState: ['isRead', 'read', 'status'] },
  marketprices: { produce: ['produce', 'crop'], location: ['market', 'county'], provenance: ['source', 'provider', 'verificationStatus', 'isDemo'] },
};

try {
  await connectDatabase(uri);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection did not expose a database handle.');
  const output = [];
  for (const [collectionName, mappings] of Object.entries(canonicalHints)) {
    const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
    if (!exists) continue;
    const collection = db.collection(collectionName);
    const [count, sample] = await Promise.all([collection.estimatedDocumentCount(), collection.find({}).limit(100).toArray()]);
    const mappingStatus = Object.fromEntries(Object.entries(mappings).map(([canonical, aliases]) => [canonical, {
      observedAliases: aliases.filter((alias) => sample.some((doc) => Object.hasOwn(doc, alias))),
      sampleDocumentsMissingAllAliases: sample.filter((doc) => !aliases.some((alias) => Object.hasOwn(doc, alias))).length,
    }]));
    output.push({ collection: collectionName, estimatedDocuments: count, sampleSize: sample.length, mappingStatus });
  }
  console.log(JSON.stringify({ database: db.databaseName, mode: 'dry-run; zero writes', findings: output }, null, 2));
} finally {
  await disconnectDatabase();
}

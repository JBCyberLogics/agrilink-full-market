import mongoose from 'mongoose';
import { allExistingModels } from './models.js';

type IndexDefinition = {
  collection: string;
  key: Record<string, 1 | -1>;
  options?: Record<string, unknown>;
};

const partialString = (field: string) => ({ [field]: { $type: 'string' } });
const partialObjectId = (fields: string[]) => Object.fromEntries(fields.map((field) => [field, { $type: 'objectId' }]));

// Indexes are deliberately declared here rather than relying on Mongoose's
// background autoIndex behavior. Unique indexes are preflighted first so an
// existing database with duplicate legacy records is left untouched.
const indexes: IndexDefinition[] = [
  { collection: 'users', key: { email: 1 }, options: { name: 'users_email_unique_ci', unique: true, partialFilterExpression: partialString('email'), collation: { locale: 'en', strength: 2 } } },
  { collection: 'users', key: { role: 1, isDeleted: 1 } },
  { collection: 'users', key: { isActive: 1, isDeleted: 1 } },
  { collection: 'farmerprofiles', key: { user: 1 }, options: { name: 'farmerprofiles_user_unique', unique: true, partialFilterExpression: partialObjectId(['user']) } },
  { collection: 'buyerprofiles', key: { user: 1 }, options: { name: 'buyerprofiles_user_unique', unique: true, partialFilterExpression: partialObjectId(['user']) } },
  { collection: 'farms', key: { farmer: 1, isActive: 1 } },
  { collection: 'products', key: { farmer: 1, createdAt: -1 } },
  { collection: 'products', key: { status: 1, createdAt: -1 } },
  { collection: 'products', key: { category: 1, status: 1 } },
  { collection: 'categories', key: { slug: 1 }, options: { name: 'categories_slug_unique', unique: true, partialFilterExpression: partialString('slug') } },
  { collection: 'categories', key: { isActive: 1, name: 1 } },
  { collection: 'shops', key: { owner: 1 } },
  { collection: 'shops', key: { sellerId: 1 } },
  { collection: 'carts', key: { customerId: 1, updatedAt: -1 } },
  { collection: 'carts', key: { customerId: 1, productId: 1 }, options: { name: 'carts_customer_product_unique', unique: true, partialFilterExpression: partialObjectId(['customerId', 'productId']) } },
  { collection: 'orders', key: { buyer: 1, createdAt: -1 } },
  { collection: 'orders', key: { customerId: 1, createdAt: -1 } },
  { collection: 'orders', key: { farmer: 1, createdAt: -1 } },
  { collection: 'orders', key: { sellerId: 1, createdAt: -1 } },
  { collection: 'orders', key: { status: 1, createdAt: -1 } },
  { collection: 'payments', key: { order: 1, createdAt: -1 } },
  { collection: 'payments', key: { orderId: 1, createdAt: -1 } },
  { collection: 'payments', key: { status: 1, createdAt: -1 } },
  { collection: 'payments', key: { provider: 1, providerReference: 1 }, options: { name: 'payments_provider_reference_unique', unique: true, partialFilterExpression: { provider: { $type: 'string' }, providerReference: { $type: 'string' } } } },
  { collection: 'notifications', key: { user: 1, createdAt: -1 } },
  { collection: 'notifications', key: { userId: 1, createdAt: -1 } },
  { collection: 'notificationlogs', key: { userId: 1, createdAt: -1 } },
  { collection: 'marketprices', key: { crop: 1, county: 1, observedAt: -1 } },
  { collection: 'marketprices', key: { source: 1, observedAt: -1 } },
  { collection: 'marketprices', key: { fingerprint: 1 }, options: { name: 'marketprices_fingerprint_unique', unique: true, partialFilterExpression: partialString('fingerprint') } },
  { collection: 'marketdatasources', key: { name: 1 }, options: { name: 'marketdatasources_name_unique_ci', unique: true, partialFilterExpression: partialString('name'), collation: { locale: 'en', strength: 2 } } },
  { collection: 'marketdatasources', key: { isActive: 1, sourceType: 1 } },
  { collection: 'providersyncs', key: { source: 1, startedAt: -1 } },
  { collection: 'providersyncs', key: { status: 1, startedAt: -1 } },
  { collection: 'refreshtokens', key: { tokenHash: 1 }, options: { name: 'refreshtokens_hash_unique', unique: true, partialFilterExpression: partialString('tokenHash') } },
  { collection: 'refreshtokens', key: { user: 1, expiresAt: -1 } },
  { collection: 'refreshtokens', key: { expiresAt: 1 }, options: { name: 'refreshtokens_expiry_ttl', expireAfterSeconds: 0 } },
  { collection: 'idempotencykeys', key: { key: 1 }, options: { name: 'idempotencykeys_key_unique', unique: true, partialFilterExpression: partialString('key') } },
  { collection: 'idempotencykeys', key: { expiresAt: 1 }, options: { name: 'idempotencykeys_expiry_ttl', expireAfterSeconds: 0 } },
  { collection: 'verificationrequests', key: { user: 1, status: 1, createdAt: -1 } },
  { collection: 'auditlogs', key: { createdAt: -1 } },
  { collection: 'auditlogs', key: { actor: 1, createdAt: -1 } },
  { collection: 'conversations', key: { participants: 1, lastMessageAt: -1 } },
  { collection: 'conversations', key: { productId: 1, lastMessageAt: -1 } },
  { collection: 'messages', key: { conversation: 1, createdAt: 1 } },
  { collection: 'aiconversations', key: { user: 1, createdAt: -1 } },
  { collection: 'aiconversations', key: { capability: 1, createdAt: -1 } },
  { collection: 'aimessages', key: { conversation: 1, createdAt: 1 } },
  { collection: 'contactmessages', key: { status: 1, createdAt: -1 } },
  { collection: 'reports', key: { status: 1, createdAt: -1 } },
  { collection: 'settings', key: { scope: 1, key: 1 }, options: { name: 'settings_scope_key_unique', unique: true, partialFilterExpression: { scope: { $type: 'string' } } } },
  { collection: 'faqs', key: { isActive: 1, createdAt: 1 } },
  { collection: 'newslettersubscribers', key: { email: 1 }, options: { name: 'newslettersubscribers_email_unique_ci', unique: true, partialFilterExpression: partialString('email'), collation: { locale: 'en', strength: 2 } } },
  { collection: 'offers', key: { sellerId: 1, isActive: 1, createdAt: -1 } },
  { collection: 'reviews', key: { productId: 1, createdAt: -1 } },
  { collection: 'reviews', key: { reviewer: 1, productId: 1 }, options: { name: 'reviews_reviewer_product_unique', unique: true, partialFilterExpression: partialObjectId(['reviewer', 'productId']) } },
  { collection: 'favorites', key: { user: 1, createdAt: -1 } },
  { collection: 'favorites', key: { user: 1, product: 1 }, options: { name: 'favorites_user_product_unique', unique: true, partialFilterExpression: partialObjectId(['user', 'product']) } },
  { collection: 'withdraws', key: { sellerId: 1, status: 1, createdAt: -1 } },
  { collection: 'otps', key: { tokenHash: 1 }, options: { name: 'otps_token_hash_unique', unique: true, partialFilterExpression: partialString('tokenHash') } },
  { collection: 'otps', key: { sentTo: 1, purpose: 1, status: 1 } },
  { collection: 'otps', key: { expiresAt: 1 }, options: { name: 'otps_expiry_ttl', expireAfterSeconds: 0 } },
  { collection: 'purchaserequests', key: { buyer: 1, status: 1, createdAt: -1 } },
  { collection: 'announcements', key: { status: 1, createdAt: -1 } },
  { collection: 'aiusage', key: { user: 1, createdAt: -1 } },
  { collection: 'aiusage', key: { capability: 1, status: 1, createdAt: -1 } },
  { collection: 'adminroles', key: { name: 1 }, options: { name: 'adminroles_name_unique_ci', unique: true, partialFilterExpression: partialString('name'), collation: { locale: 'en', strength: 2 } } },
];

async function assertNoUniqueConflicts(db: NonNullable<typeof mongoose.connection.db>, definition: IndexDefinition) {
  if (!definition.options?.unique) return;
  const collection = db.collection(definition.collection);
  const fields = Object.keys(definition.key);
  const groupKey = Object.fromEntries(fields.map((field) => [field, `$${field}`]));
  const pipeline: Record<string, unknown>[] = [];
  if (definition.options.partialFilterExpression) pipeline.push({ $match: definition.options.partialFilterExpression });
  pipeline.push(
    { $group: { _id: groupKey, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  );
  const aggregateOptions = definition.options.collation ? { collation: definition.options.collation } : {};
  const duplicates = await collection.aggregate(pipeline as any, aggregateOptions as any).toArray();
  if (duplicates.length) {
    throw new Error(`Database initialization stopped: collection "${definition.collection}" contains duplicate values for unique index "${String(definition.options.name)}". Review and resolve the records with a backed-up migration before retrying.`);
  }
}

/** Create canonical empty collections and safe indexes without inserting records. */
export async function initializeDatabase(databaseName = 'agrilink') {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Cannot initialize collections without a connected MongoDB database.');
  if (databaseName !== 'agrilink' && !/^agrilink(?:_[a-z0-9-]+)?_test$/.test(databaseName)) {
    throw new Error('Database initialization is restricted to the application database or an explicitly named AgriLink test database.');
  }
  if (db.databaseName !== databaseName) {
    throw new Error(`Database initialization expected "${databaseName}"; the active database is "${db.databaseName}".`);
  }

  const requiredCollections = [...new Set(Object.values(allExistingModels).map((model) => model.collection.collectionName))].sort();
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
  const createdCollections: string[] = [];
  for (const name of requiredCollections) {
    if (existing.has(name)) continue;
    try {
      await db.createCollection(name);
      createdCollections.push(name);
    } catch (error) {
      // Multiple app instances may start together. CollectionExists is safe;
      // every other error stops startup without dropping or rewriting data.
      if ((error as { code?: number })?.code !== 48) throw error;
    }
  }

  const createdIndexes: string[] = [];
  for (const definition of indexes) {
    const collection = db.collection(definition.collection);
    const indexName = String(definition.options?.name ?? Object.entries(definition.key).map(([field, direction]) => `${field}_${direction}`).join('_'));
    const existingIndex = (await collection.indexes()).find((index) => index.name === indexName);
    if (existingIndex) continue;
    await assertNoUniqueConflicts(db, definition);
    await collection.createIndex(definition.key, { ...definition.options, name: indexName } as any);
    createdIndexes.push(`${definition.collection}.${indexName}`);
  }

  return { database: db.databaseName, collections: requiredCollections, createdCollections, createdIndexes };
}

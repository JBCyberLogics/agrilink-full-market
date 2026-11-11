import 'dotenv/config';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { initializeDatabase } from '../src/database/initialize.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Set MONGODB_URI to the AgriLink database before initializing collections.');

try {
  await connectDatabase(uri);
  const result = await initializeDatabase();
  console.log(JSON.stringify({
    database: result.database,
    collections: result.collections,
    createdCollections: result.createdCollections,
    createdIndexes: result.createdIndexes,
    applicationRecordsInserted: 0,
  }, null, 2));
} finally {
  await disconnectDatabase();
}

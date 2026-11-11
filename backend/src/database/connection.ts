import mongoose from 'mongoose';

export async function connectDatabase(uri: string, options: { test?: boolean } = {}) {
  await mongoose.connect(uri, {
    autoIndex: options.test === true,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    appName: 'AgriLinkBackend',
  });
  return mongoose.connection;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

export async function pingDatabase() {
  if (mongoose.connection.readyState !== 1) return false;
  const result = await mongoose.connection.db?.admin().command({ ping: 1 });
  return result?.ok === 1;
}

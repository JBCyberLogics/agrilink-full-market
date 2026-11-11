import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { initializeDatabase } from '../src/database/initialize.js';
import { AuditLog, User } from '../src/database/models.js';
import { hashPassword } from '../src/services/password.js';

async function readHidden(prompt: string) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Administrator setup requires an interactive terminal so the password is not echoed.');
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (input: string) => {
      for (const character of input) {
        if (character === '\u0003') return finish(new Error('Administrator setup cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    stdin.on('data', onData);
  });
}

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('Set MONGODB_URI to the AgriLink database before creating an administrator.');

const prompt = readline.createInterface({ input: stdin, output: stdout });
let fullName: string;
let email: string;
try {
  if (!stdin.isTTY) throw new Error('Administrator setup requires an interactive terminal.');
  fullName = (await prompt.question('Administrator full name: ')).trim();
  email = (await prompt.question('Administrator email: ')).trim().toLowerCase();
} finally {
  prompt.close();
}
if (fullName.length < 2 || fullName.length > 100) throw new Error('Enter a name between 2 and 100 characters.');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid administrator email address.');

const password = await readHidden('Administrator password (10+ characters): ');
if (password.length < 10 || password.length > 128) throw new Error('Password must be between 10 and 128 characters.');

try {
  await connectDatabase(uri);
  await initializeDatabase();
  const existingRoot = await User.exists({ role: 'super_admin', isDeleted: { $ne: true } });
  if (existingRoot) throw new Error('A super administrator already exists. Use the authorized administrator management workflow instead.');
  if (await User.exists({ email })) throw new Error('An account with this email already exists.');

  const names = fullName.split(/\s+/);
  const user = await User.create({
    email,
    fullName,
    firstName: names[0],
    lastName: names.slice(1).join(' '),
    passwordHash: await hashPassword(password),
    role: 'super_admin',
    isActive: true,
    isDeleted: false,
    isEmailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await AuditLog.create({
    actor: user._id,
    action: 'administrator.bootstrap_created',
    resource: 'user',
    resourceId: String(user._id),
    outcome: 'success',
    metadata: { source: 'interactive-local-setup' },
    createdAt: new Date(),
  });
  console.log(`Created the initial AgriLink Control administrator (${email}). No password was logged.`);
} finally {
  await disconnectDatabase();
}

// Applies pending SQL migrations. Plain JS on purpose: the production image installs
// with --omit=dev, so tsx is not available there and migrations/run.ts cannot run.
// Uses `pg` directly, which is a production dependency.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';

const { Pool } = pkg;

// A .env file is normal in dev and absent in a container, where DATABASE_URL comes
// from real environment variables. Loading it is best-effort — unlike run.ts, a missing
// .env must not abort the run.
try {
  const { config } = await import('dotenv');
  config();
} catch {
  // dotenv unavailable — rely on the ambient environment.
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const files = (await fs.readdir(__dirname))
      .filter(f => f.endsWith('.sql') && !f.includes('rollback'))
      .sort();

    // --baseline records every existing migration as applied WITHOUT running it.
    // Run this once on a database that predates this runner (e.g. one built with
    // db:push), otherwise the first real run would try to replay 0001 onwards —
    // and not all of those old migrations are idempotent.
    if (process.argv.includes('--baseline')) {
      for (const file of files) {
        await client.query(
          'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [file]
        );
      }
      console.log(`Baselined ${files.length} migration(s) as already applied.`);
      console.log('Nothing was executed. Future migrations will run normally.');
      return;
    }

    const { rows } = await client.query('SELECT name FROM migrations');
    const applied = new Set(rows.map(r => r.name));

    const pending = files.filter(f => !applied.has(f));
    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    console.log(`${pending.length} pending migration(s): ${pending.join(', ')}`);

    for (const file of pending) {
      console.log(`Running migration: ${file}`);
      const sql = await fs.readFile(path.join(__dirname, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ${file} completed`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`  ${file} FAILED:`, error.message);
        throw error;
      }
    }

    console.log('All migrations completed successfully');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(error => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});

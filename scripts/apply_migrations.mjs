/**
 * MANUAL HELPER / RUNNER — not the migration system source of truth.
 * Source of truth is the Supabase migration history (supabase_migrations.schema_migrations).
 * This script re-executes whole SQL files from FROM_MIGRATION onward; it tracks
 * no history, no checksums, no pending state. Safe to re-run only because the
 * SQL itself is written idempotently (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT).
 * All new schema changes must be forward-only migrations, never rewrites of old files.
 *
 * SUPABASE_ACCESS_TOKEN required. Optional: FROM_MIGRATION=20240806000003
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = 'thmsfdugojokxtemnqdw';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const FROM = process.env.FROM_MIGRATION || '20240806000001';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

if (!TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}

const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => f >= FROM);

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runSql(sql, label, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
        signal: controller.signal,
      }
    );
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = typeof body === 'object' ? JSON.stringify(body) : body;
      const retryable = res.status >= 500 || res.status === 429;
      if (retryable && attempt < 4) {
        console.log(`retry ${attempt} (${res.status})...`);
        await sleep(2000 * attempt);
        return runSql(sql, label, attempt + 1);
      }
      throw new Error(`[${label}] HTTP ${res.status}: ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

for (const file of files) {
  const full = path.join(MIGRATIONS_DIR, file);
  const sql = fs.readFileSync(full, 'utf8');
  process.stdout.write(`Applying ${file} (${sql.length} bytes) ... `);
  try {
    await runSql(sql, file);
    console.log('OK');
  } catch (err) {
    console.log('FAIL');
    console.error(err.message || err);
    process.exit(1);
  }
}

console.log('\nAll migrations applied.');

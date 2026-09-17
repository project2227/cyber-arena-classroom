const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || '';

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10
  });
}

async function runMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(name => /^\d+.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const appliedRows = await client.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.rows.map(row => row.version));
  const ran = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
      console.log(`[db] migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }

  return ran;
}

async function runStartupSelfTest(client) {
  await client.query('BEGIN');
  try {
    const username = `__cyber_arena_selftest_${Date.now()}__`;
    const inserted = await client.query(`
      INSERT INTO users(username,password_hash,display_handle)
      VALUES($1,$2,$1)
      RETURNING user_id,username,display_handle,onboarding_completed,account_xp,account_level
    `, [username, 'self-test-hash']);

    const user = inserted.rows[0];
    if (!user?.user_id || !user?.username || !user?.display_handle) {
      throw new Error('Database signup/profile self-test returned incomplete user data.');
    }

    await client.query('INSERT INTO player_stats(user_id) VALUES($1)', [user.user_id]);
    const stats = await client.query('SELECT user_id FROM player_stats WHERE user_id=$1', [user.user_id]);
    if (stats.rowCount !== 1) throw new Error('Database signup/profile self-test could not create player_stats.');

    await client.query('ROLLBACK');
    console.log('[db] signup/profile self-test passed');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  }
}

async function initDb() {
  if (!pool) {
    console.warn('[db] DATABASE_URL is not set. Running in demo-memory mode.');
    return false;
  }

  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(sql);
    await runMigrations(client);
    await runStartupSelfTest(client);
    console.log('[db] schema ready');
    return true;
  } finally {
    client.release();
  }
}

async function query(text, params = []) {
  if (!pool) throw new Error('Database unavailable in demo-memory mode.');
  return pool.query(text, params);
}

module.exports = {
  pool,
  hasDb: () => Boolean(pool),
  initDb,
  query
};

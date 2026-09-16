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

async function initDb() {
  if (!pool) {
    console.warn('[db] DATABASE_URL is not set. Running in demo-memory mode.');
    return false;
  }

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] schema ready');
  return true;
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

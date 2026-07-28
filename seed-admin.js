// One-time script: creates the single admin user in Postgres, using the
// username/password from .env. Safe to re-run — if the username already
// exists, it's skipped rather than duplicated or overwritten.

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function main() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.error('ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const existing = await client.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing.rows.length) {
    console.log('User "' + username + '" already exists — nothing to do.');
    await client.end();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await client.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
    [username, passwordHash]
  );

  console.log('Created admin user "' + username + '".');
  await client.end();
}

main().catch(function(e) { console.error('Seed failed: ' + e.message); process.exit(1); });

/**
 * Creates academic_support_db and loads the seed data by running ../schema.sql.
 * Uses the MySQL credentials from .env, so the mysql command-line client isn't needed.
 *
 *   npm run db:init
 *
 * WARNING: drops and recreates the database. (The server also seeds an empty
 * database automatically on first start, so hosted setups don't need this.)
 */
import mysql from 'mysql2/promise';
import { config } from '../config';
import { applyDemoPassword, runSchemaFile } from '../setup';

async function main() {
  const { database: _database, ...server } = config.db;

  console.log(`Connecting to MySQL at ${server.host}:${server.port} as "${server.user}"...`);
  const connection = await mysql.createConnection({ ...server, multipleStatements: true });
  try {
    await runSchemaFile(connection);
    console.log(`Database ${config.db.database} created and seeded.`);
    console.log(await applyDemoPassword(connection)
      ? 'Demo accounts use the password in DEMO_PASSWORD.'
      : 'Demo accounts all use the password Study@2026 (see README.md).');
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('Database setup failed:', err instanceof Error ? err.message || (err as NodeJS.ErrnoException).code : err);
  process.exit(1);
});

import fs from 'fs';
import bcrypt from 'bcryptjs';
import mysql, { Connection, RowDataPacket } from 'mysql2/promise';
import { config } from './config';

/** Run schema.sql: (re)creates the database with all tables and demo data. */
export async function runSchemaFile(connection: Connection): Promise<void> {
  let sql = fs.readFileSync(config.schemaFile, 'utf8');
  // schema.sql names the database academic_support_db; honour a different DB_NAME
  if (config.db.database !== 'academic_support_db') {
    sql = sql.replace(/academic_support_db/g, config.db.database);
  }
  await connection.query(sql);
}

/** Give every demo account DEMO_PASSWORD instead of the published Study@2026. */
export async function applyDemoPassword(connection: Connection): Promise<boolean> {
  if (!config.demoPassword) return false;
  const hash = await bcrypt.hash(config.demoPassword, 10);
  await connection.query(`UPDATE \`${config.db.database}\`.users SET password_hash = ?`, [hash]);
  return true;
}

/** Tables added after the original schema; safe to run on every start. */
const MIGRATIONS = [
  // Uploaded files live in the database, so they survive hosts that wipe local disk on restart
  `CREATE TABLE IF NOT EXISTS material_files (
     material_id   INT PRIMARY KEY,
     original_name VARCHAR(255) NOT NULL,
     mime_type     VARCHAR(100) NOT NULL,
     size_bytes    INT NOT NULL,
     content       LONGBLOB NOT NULL,
     CONSTRAINT fk_files_material
       FOREIGN KEY (material_id) REFERENCES course_materials (material_id) ON DELETE CASCADE
   )`,
];

/**
 * Called once when the server starts:
 *  - an empty database (e.g. a new hosted MySQL) gets the schema and demo data;
 *  - an existing one gets any tables added since it was created.
 */
export async function prepareDatabase(): Promise<void> {
  const { database, ...server } = config.db;
  const connection = await mysql.createConnection({ ...server, multipleStatements: true });
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = 'users'`,
      [database],
    );
    if (Number(rows[0].n) === 0) {
      if (!config.seedOnEmpty) {
        throw new Error(`Database "${database}" has no tables. Run "npm run db:init" or set SEED_ON_EMPTY=true.`);
      }
      console.log(`Database "${database}" is empty: creating tables and demo data...`);
      await runSchemaFile(connection);
      if (await applyDemoPassword(connection)) console.log('Demo accounts use DEMO_PASSWORD.');
    }
    await connection.query(`USE \`${database}\``);
    for (const statement of MIGRATIONS) await connection.query(statement);
  } finally {
    await connection.end();
  }
}

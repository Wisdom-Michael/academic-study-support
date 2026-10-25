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
  // Contact details shared with a peer once both sides accept, and whether a student may be asked to help
  `CREATE TABLE IF NOT EXISTS user_profiles (
     user_id           INT PRIMARY KEY,
     phone_number      VARCHAR(30) NULL,
     available_to_help TINYINT(1) NOT NULL DEFAULT 1,
     CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
   )`,
  // Each match's context and each side's answer; a match is active once both have accepted
  `CREATE TABLE IF NOT EXISTS match_details (
     match_id            INT PRIMARY KEY,
     reason              VARCHAR(255) NULL,
     helper_summary      VARCHAR(255) NULL,
     student_accepted_at TIMESTAMP NULL,
     helper_accepted_at  TIMESTAMP NULL,
     created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT fk_details_match FOREIGN KEY (match_id) REFERENCES peer_matches (match_id) ON DELETE CASCADE
   )`,
  // Matches made before two-sided acceptance: active or finished ones count as accepted by both
  `INSERT IGNORE INTO match_details (match_id, student_accepted_at, helper_accepted_at)
   SELECT match_id,
          IF(match_status = 'pending', NULL, CURRENT_TIMESTAMP),
          IF(match_status = 'pending', NULL, CURRENT_TIMESTAMP)
     FROM peer_matches`,
  // Pairings someone said no to, so the same two people aren't suggested again
  `CREATE TABLE IF NOT EXISTS declined_matches (
     decline_id  INT AUTO_INCREMENT PRIMARY KEY,
     student_id  INT NOT NULL,
     helper_id   INT NOT NULL,
     module_code VARCHAR(20) NOT NULL,
     declined_by ENUM('student', 'helper') NOT NULL,
     declined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_declined_pair (student_id, module_code),
     CONSTRAINT fk_declined_student FOREIGN KEY (student_id) REFERENCES users (user_id) ON DELETE CASCADE,
     CONSTRAINT fk_declined_helper FOREIGN KEY (helper_id) REFERENCES users (user_id) ON DELETE CASCADE
   )`,
  // In-app notifications shown under the bell
  `CREATE TABLE IF NOT EXISTS notifications (
     notification_id INT AUTO_INCREMENT PRIMARY KEY,
     user_id         INT NOT NULL,
     title           VARCHAR(200) NOT NULL,
     body            TEXT NOT NULL,
     link            VARCHAR(255) NULL,
     is_read         TINYINT(1) NOT NULL DEFAULT 0,
     created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_notifications_user (user_id, is_read, created_at),
     CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
   )`,
];

/** Columns added to existing tables later on: [table, column, definition]. */
const COLUMN_MIGRATIONS: [string, string, string][] = [
  // Pairings a lecturer made by hand, and the note they added
  ['match_details', 'paired_by_id', 'INT NULL'],
  ['match_details', 'lecturer_note', 'VARCHAR(500) NULL'],
];

async function addMissingColumns(connection: Connection, database: string): Promise<void> {
  for (const [table, column, definition] of COLUMN_MIGRATIONS) {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
      [database, table, column],
    );
    if (Number(rows[0].n) === 0) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

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
    await addMissingColumns(connection, database);
  } finally {
    await connection.end();
  }
}

import mysql, { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from './config';

// A connection pool reuses a small number of MySQL connections across requests.
export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  // Return DECIMAL columns (e.g. completion_percentage) as numbers, not strings
  decimalNumbers: true,
});

/** Run a SELECT and get back typed rows. Always use `?` placeholders for values. */
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

/** Run an INSERT / UPDATE / DELETE and get back the insert id and affected rows. */
export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await pool.query<ResultSetHeader>(sql, params);
  return result;
}

/** Check the database is reachable; called once when the server starts. */
export async function checkConnection(): Promise<void> {
  const connection = await pool.getConnection();
  connection.release();
}

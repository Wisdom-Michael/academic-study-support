import fs from 'fs';
import path from 'path';
import { config } from './config';
import { query } from './db';
import { HttpError } from './types';

/**
 * Where a material's file lives, by its file_path:
 *   db/<name>.<ext>   uploaded through the app, stored in the material_files table
 *   seed/<name>.md    demo chapters shipped with the code in server/uploads/seed
 *   <name>.<ext>      uploads from before files moved into the database (on local disk)
 */
export const DB_PREFIX = 'db/';

/** Resolve a stored disk file_path to an absolute path, refusing anything outside the uploads folder. */
export function resolveUploadPath(filePath: string): string {
  const absolute = path.resolve(config.uploadsDir, filePath);
  if (!absolute.startsWith(config.uploadsDir + path.sep)) {
    throw new HttpError(400, 'Invalid file path.');
  }
  return absolute;
}

/** Load a material's file contents, wherever it is stored. */
export async function readMaterialFile(materialId: number, filePath: string): Promise<Buffer> {
  if (filePath.startsWith(DB_PREFIX)) {
    const [row] = await query<{ content: Buffer }>(`SELECT content FROM material_files WHERE material_id = ?`, [materialId]);
    if (!row) throw new HttpError(404, 'The file for this material is missing.');
    return row.content;
  }
  const absolute = resolveUploadPath(filePath);
  if (!fs.existsSync(absolute)) throw new HttpError(404, 'The file for this material is missing from the server.');
  return fs.readFileSync(absolute);
}

/** File extension (".pdf", ".md", ...) of a stored file_path. */
export const extensionOf = (filePath: string) => path.extname(filePath).toLowerCase();

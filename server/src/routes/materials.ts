import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { ResultSetHeader } from 'mysql2/promise';
import { config } from '../config';
import { execute, pool, query } from '../db';
import { currentUser, requireRole } from '../middleware/auth';
import { HttpError } from '../types';
import { DB_PREFIX, extensionOf, readMaterialFile, resolveUploadPath } from '../uploads';
import { idParam, requireModuleCode, requireText } from '../validation';

const router = Router();

// ---------------------------------------------------------------------
// File uploads: held in memory, then saved to the material_files table
// ---------------------------------------------------------------------
const ALLOWED_EXTENSIONS = ['.pdf', '.md', '.txt', '.docx', '.pptx'];
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) cb(null, true);
    else cb(new HttpError(400, `Upload a ${ALLOWED_EXTENSIONS.join(', ')} file.`));
  },
});


// ---------------------------------------------------------------------
// Reading materials, joined with the signed-in student's own progress
// ---------------------------------------------------------------------
interface MaterialRow {
  material_id: number;
  title: string;
  module_code: string;
  file_path: string;
  uploaded_by_id: number;
  uploaded_by: string;
  completion_percentage: number | null;
  score_achieved: number | null;
  last_updated: Date | null;
  check_id: number | null;
  question_count: number;
}

function toMaterial(row: MaterialRow) {
  return {
    materialId: row.material_id,
    title: row.title,
    moduleCode: row.module_code,
    fileType: path.extname(row.file_path).slice(1).toLowerCase(),
    uploadedById: row.uploaded_by_id,
    uploadedBy: row.uploaded_by,
    progress: row.completion_percentage === null ? null : {
      completionPercentage: Number(row.completion_percentage),
      scoreAchieved: row.score_achieved,
      lastUpdated: row.last_updated,
    },
    conceptCheck: row.check_id === null ? null : { checkId: row.check_id, questionCount: Number(row.question_count) },
  };
}

async function loadMaterials(userId: number, filters: { moduleCode?: string; search?: string; materialId?: number }) {
  const conditions: string[] = [];
  const params: unknown[] = [userId];
  if (filters.moduleCode) { conditions.push('cm.module_code = ?'); params.push(filters.moduleCode); }
  if (filters.search) { conditions.push('cm.title LIKE ?'); params.push(`%${filters.search}%`); }
  if (filters.materialId) { conditions.push('cm.material_id = ?'); params.push(filters.materialId); }

  const rows = await query<MaterialRow>(
    `SELECT cm.material_id, cm.title, cm.module_code, cm.file_path, cm.uploaded_by_id,
            u.full_name AS uploaded_by,
            mp.completion_percentage, mp.score_achieved, mp.last_updated,
            cc.check_id,
            (SELECT COUNT(*) FROM quiz_questions q WHERE q.check_id = cc.check_id) AS question_count
       FROM course_materials cm
       JOIN users u ON u.user_id = cm.uploaded_by_id
       LEFT JOIN milestone_progress mp ON mp.material_id = cm.material_id AND mp.student_id = ?
       LEFT JOIN concept_checks cc ON cc.material_id = cm.material_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY cm.module_code, cm.material_id`,
    params,
  );
  return rows.map(toMaterial);
}

// GET /api/materials?module=CS201&q=recursion
router.get('/', async (req, res) => {
  const moduleCode = typeof req.query.module === 'string' ? req.query.module.trim().toUpperCase() : '';
  const search = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  res.json({ materials: await loadMaterials(currentUser(req).userId, { moduleCode, search }) });
});

// GET /api/materials/modules: every module code that has materials (for the filter)
router.get('/modules', async (_req, res) => {
  const rows = await query<{ module_code: string }>(
    `SELECT DISTINCT module_code FROM course_materials ORDER BY module_code`,
  );
  res.json({ modules: rows.map((r) => r.module_code) });
});

// GET /api/materials/:id
router.get('/:id', async (req, res) => {
  const [material] = await loadMaterials(currentUser(req).userId, { materialId: idParam(req.params.id) });
  if (!material) throw new HttpError(404, 'This material no longer exists.');
  res.json({ material });
});

// GET /api/materials/:id/file: the uploaded file itself
router.get('/:id/file', async (req, res) => {
  const [row] = await query<{ file_path: string }>(
    `SELECT file_path FROM course_materials WHERE material_id = ?`, [idParam(req.params.id)],
  );
  if (!row) throw new HttpError(404, 'This material no longer exists.');

  const content = await readMaterialFile(idParam(req.params.id), row.file_path);
  const ext = extensionOf(row.file_path);
  // Markdown and text are shown as text in the reader
  res.type(ext === '.md' || ext === '.txt' ? 'text/plain; charset=utf-8' : MIME_TYPES[ext] ?? 'application/octet-stream');
  res.send(content);
});

// POST /api/materials (multipart form: title, moduleCode, file)
router.post('/', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, 'Choose a file to upload.');
  const title = requireText(req.body, 'title', 'Title', 200);
  const moduleCode = requireModuleCode(req.body);
  const ext = extensionOf(file.originalname);
  // A random name, so stored paths never clash; the extension says how to read the file
  const filePath = `${DB_PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

  // Save the material and its file together, or neither
  const connection = await pool.getConnection();
  let materialId: number;
  try {
    await connection.beginTransaction();
    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO course_materials (title, module_code, file_path, uploaded_by_id) VALUES (?, ?, ?, ?)`,
      [title, moduleCode, filePath, currentUser(req).userId],
    );
    materialId = result.insertId;
    await connection.query(
      `INSERT INTO material_files (material_id, original_name, mime_type, size_bytes, content) VALUES (?, ?, ?, ?, ?)`,
      [materialId, file.originalname.slice(0, 255), MIME_TYPES[ext], file.size, file.buffer],
    );
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }

  const [material] = await loadMaterials(currentUser(req).userId, { materialId });
  res.status(201).json({ material });
});

// DELETE /api/materials/:id: faculty, or the person who uploaded it
router.delete('/:id', async (req, res) => {
  const user = currentUser(req);
  const [row] = await query<{ file_path: string; uploaded_by_id: number }>(
    `SELECT file_path, uploaded_by_id FROM course_materials WHERE material_id = ?`, [idParam(req.params.id)],
  );
  if (!row) throw new HttpError(404, 'This material no longer exists.');
  if (user.role !== 'faculty_admin' && row.uploaded_by_id !== user.userId) {
    throw new HttpError(403, 'Only faculty or the uploader can delete this material.');
  }

  // Files stored in the database are removed with the material (ON DELETE CASCADE)
  await execute(`DELETE FROM course_materials WHERE material_id = ?`, [idParam(req.params.id)]);
  const onDisk = !row.file_path.startsWith('seed/') && !row.file_path.startsWith(DB_PREFIX);
  if (onDisk) fs.rmSync(resolveUploadPath(row.file_path), { force: true });
  res.status(204).end();
});

// PUT /api/materials/:id/progress { completionPercentage }: the reading tracker
router.put('/:id/progress', requireRole('student'), async (req, res) => {
  const materialId = idParam(req.params.id);
  const percentage = Number(req.body?.completionPercentage);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new HttpError(400, 'Completion must be a number from 0 to 100.');
  }
  const rounded = Math.round(percentage * 100) / 100;

  // GREATEST keeps the furthest point reached, so scrolling back up never lowers progress
  await execute(
    `INSERT INTO milestone_progress (student_id, material_id, completion_percentage)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       completion_percentage = GREATEST(completion_percentage, ?),
       last_updated = CURRENT_TIMESTAMP`,
    [currentUser(req).userId, materialId, rounded, rounded],
  );

  const [material] = await loadMaterials(currentUser(req).userId, { materialId });
  if (!material) throw new HttpError(404, 'This material no longer exists.');
  res.json({ progress: material.progress });
});

export default router;

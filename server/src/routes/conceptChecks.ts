import { Request, Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { execute, pool, query } from '../db';
import { currentUser, requireRole } from '../middleware/auth';
import { matchWaitingStudents, MatchOutcome, recommendHelper } from '../services/matching';
import { GeneratedQuestion, generateQuestions, MAX_QUESTIONS, MIN_QUESTIONS } from '../services/questionGenerator';
import { HttpError } from '../types';
import { extensionOf, readMaterialFile } from '../uploads';
import { idParam, requireText } from '../validation';

// Mounted at /api/materials/:materialId/concept-check
const router = Router({ mergeParams: true });
const materialIdOf = (req: Request) => idParam((req.params as { materialId?: string }).materialId, 'Material ID');

type QuestionType = 'multiple_choice' | 'true_false';

interface QuestionRow {
  question_id: number;
  question_type: QuestionType;
  prompt: string;
  options: string[] | string;
  correct_index: number;
  explanation: string | null;
}

// MySQL returns JSON columns already parsed; MariaDB returns them as text
const parseOptions = (options: string[] | string): string[] =>
  typeof options === 'string' ? JSON.parse(options) : options;

async function findCheck(materialId: number) {
  const [check] = await query<{ check_id: number; title: string; module_code: string; material_title: string }>(
    `SELECT cc.check_id, cc.title, cm.module_code, cm.title AS material_title
       FROM concept_checks cc
       JOIN course_materials cm ON cm.material_id = cc.material_id
      WHERE cc.material_id = ?`,
    [materialId],
  );
  return check ?? null;
}

async function loadQuestions(checkId: number) {
  return query<QuestionRow>(
    `SELECT question_id, question_type, prompt, options, correct_index, explanation
       FROM quiz_questions WHERE check_id = ? ORDER BY position, question_id`,
    [checkId],
  );
}

// GET: the questions WITHOUT their answers
router.get('/', async (req, res) => {
  const check = await findCheck(materialIdOf(req));
  if (!check) return res.json({ conceptCheck: null });

  const questions = await loadQuestions(check.check_id);
  res.json({
    conceptCheck: {
      checkId: check.check_id,
      title: check.title,
      questions: questions.map((q) => ({
        questionId: q.question_id,
        questionType: q.question_type,
        prompt: q.prompt,
        options: parseOptions(q.options),
      })),
    },
  });
});

// POST /submit { answers: { [questionId]: chosenOptionIndex } }: automatic grading
router.post('/submit', requireRole('student'), async (req, res) => {
  const materialId = materialIdOf(req);
  const student = currentUser(req);
  const check = await findCheck(materialId);
  if (!check) throw new HttpError(404, 'This chapter has no concept check yet.');

  const questions = await loadQuestions(check.check_id);
  if (questions.length === 0) throw new HttpError(400, 'This concept check has no questions yet.');

  const answers: Record<string, unknown> = req.body?.answers ?? {};
  const unanswered = questions.filter((q) => typeof answers[q.question_id] !== 'number');
  if (unanswered.length > 0) {
    throw new HttpError(400, 'Answer every question before submitting.');
  }

  // 1. Grade each answer and collect immediate feedback
  const results = questions.map((q) => {
    const chosenIndex = answers[q.question_id] as number;
    return {
      questionId: q.question_id,
      chosenIndex,
      correctIndex: q.correct_index,
      isCorrect: chosenIndex === q.correct_index,
      explanation: q.explanation,
    };
  });
  const correctCount = results.filter((r) => r.isCorrect).length;
  const score = Math.round((correctCount / questions.length) * 100);

  // 2. Store the latest score against this chapter's milestone
  await execute(
    `INSERT INTO milestone_progress (student_id, material_id, completion_percentage, score_achieved)
     VALUES (?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE score_achieved = ?, last_updated = CURRENT_TIMESTAMP`,
    [student.userId, materialId, score, score],
  );

  // 3. Below the threshold: run the peer-mentorship matching algorithm
  let match: MatchOutcome | null = null;
  if (score < config.matchScoreThreshold) {
    // Struggling: recommend a classmate who is doing well in this module
    match = await recommendHelper(student.userId, check.module_code, `Scored ${score}% on “${check.material_title}”`);
  } else if (score >= config.helperScoreThreshold) {
    // Doing well: this student may now be the helper someone in the module is waiting for
    await matchWaitingStudents(check.module_code);
  }

  res.json({
    score,
    correctCount,
    totalQuestions: questions.length,
    threshold: config.matchScoreThreshold,
    moduleCode: check.module_code,
    results,
    match,
  });
});

// ---------------------------------------------------------------------
// Writing questions: lecturers, or whoever uploaded the material
// ---------------------------------------------------------------------
interface ManagedMaterial { material_id: number; title: string; module_code: string; file_path: string }

async function loadManagedMaterial(req: Request): Promise<ManagedMaterial> {
  const user = currentUser(req);
  const [material] = await query<ManagedMaterial & { uploaded_by_id: number }>(
    `SELECT material_id, title, module_code, file_path, uploaded_by_id FROM course_materials WHERE material_id = ?`,
    [materialIdOf(req)],
  );
  if (!material) throw new HttpError(404, 'This material no longer exists.');
  if (user.role !== 'faculty_admin' && material.uploaded_by_id !== user.userId) {
    throw new HttpError(403, 'Only lecturers or the person who uploaded this material can change its concept check.');
  }
  return material;
}

/** Save questions in one transaction, creating the concept check on first use. */
export async function saveQuestions(material: ManagedMaterial, questions: GeneratedQuestion[], replaceExisting: boolean) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT IGNORE INTO concept_checks (material_id, title) VALUES (?, ?)`,
      [material.material_id, `Concept check: ${material.title}`.slice(0, 200)],
    );
    const [[check]] = await connection.query<RowDataPacket[]>(
      `SELECT check_id FROM concept_checks WHERE material_id = ?`, [material.material_id],
    );
    if (replaceExisting) {
      await connection.query(`DELETE FROM quiz_questions WHERE check_id = ?`, [check.check_id]);
    }
    const [[{ next_position }]] = await connection.query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM quiz_questions WHERE check_id = ?`,
      [check.check_id],
    );
    for (const [i, q] of questions.entries()) {
      await connection.query(
        `INSERT INTO quiz_questions (check_id, question_type, prompt, options, correct_index, explanation, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [check.check_id, q.questionType, q.prompt, JSON.stringify(q.options), q.correctIndex, q.explanation || null, Number(next_position) + i],
      );
    }
    const [[{ total }]] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM quiz_questions WHERE check_id = ?`, [check.check_id],
    );
    await connection.commit();
    return Number(total);
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// POST /generate { count, replaceExisting }: write a test from the uploaded material
router.post('/generate', async (req, res) => {
  const material = await loadManagedMaterial(req);
  const count = Number(req.body?.count ?? 10);
  if (!Number.isInteger(count) || count < MIN_QUESTIONS || count > MAX_QUESTIONS) {
    throw new HttpError(400, `Choose between ${MIN_QUESTIONS} and ${MAX_QUESTIONS} questions.`);
  }

  const questions = await generateQuestions({
    file: await readMaterialFile(material.material_id, material.file_path),
    ext: extensionOf(material.file_path),
    title: material.title,
    moduleCode: material.module_code,
  }, count);
  const totalQuestions = await saveQuestions(material, questions, req.body?.replaceExisting === true);
  res.status(201).json({ added: questions.length, totalQuestions });
});

// POST /questions: add one question by hand
router.post('/questions', async (req, res) => {
  const material = await loadManagedMaterial(req);
  const questionType = req.body?.questionType as QuestionType;
  const prompt = requireText(req.body, 'prompt', 'Question', 1000);
  const explanation = typeof req.body?.explanation === 'string' ? req.body.explanation.trim().slice(0, 1000) : '';
  const correctIndex = Number(req.body?.correctIndex);

  let options: string[];
  if (questionType === 'true_false') {
    options = ['True', 'False'];
  } else if (questionType === 'multiple_choice') {
    const raw: unknown[] = Array.isArray(req.body?.options) ? req.body.options : [];
    options = raw.filter((o): o is string => typeof o === 'string').map((o) => o.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 6) {
      throw new HttpError(400, 'Multiple-choice questions need between 2 and 6 answer options.');
    }
  } else {
    throw new HttpError(400, 'Question type must be multiple choice or true/false.');
  }
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    throw new HttpError(400, 'Mark which option is the correct answer.');
  }

  const totalQuestions = await saveQuestions(material, [{ questionType, prompt, options, correctIndex, explanation }], false);
  res.status(201).json({ added: 1, totalQuestions });
});

export default router;

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { HttpError } from '../types';

/**
 * Automatic concept-check generation.
 *
 *   1. Read the uploaded file: Markdown/text as-is, Word and PowerPoint via text
 *      extraction, PDFs sent whole (Claude reads PDFs directly, including tables).
 *   2. Ask Claude for N questions. Structured outputs make the reply match a
 *      JSON schema, so there is no free text to parse.
 *   3. Check every question (option counts, a valid answer index) and drop any that
 *      don't hold up, so a bad question never reaches students.
 */
export const MIN_QUESTIONS = 5;
export const MAX_QUESTIONS = 20;
const MODEL = 'claude-opus-5-5';
const MIN_TEXT_LENGTH = 300; // characters: less than this is too thin to write a test from

export interface GeneratedQuestion {
  questionType: 'multiple_choice' | 'true_false';
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const GeneratedQuizSchema = z.object({
  questions: z.array(
    z.object({
      question_type: z.enum(['multiple_choice', 'true_false']),
      prompt: z.string(),
      options: z.array(z.string()),
      correct_index: z.number().int(),
      explanation: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You write formative concept-check quizzes for university Computer Science students. \
Students take the quiz straight after reading the material, to find out whether they understood it; \
a score below 50% connects them with a peer mentor, so the questions should separate real understanding \
from guessing.

Write questions that:
- test the ideas, reasoning and definitions in the material, not trivia such as headings, page numbers or names of authors;
- can be answered from the material alone, and are self-contained (don't write "according to the text");
- have exactly one defensible correct answer, with wrong options that reflect plausible misconceptions rather than obvious throwaways;
- may quote a short snippet of code or notation from the material, but never ask the student to write, run or debug code;
- cover the whole material rather than clustering on its opening section.

Format:
- About two thirds multiple choice with exactly 4 options; the rest true/false with options exactly ["True", "False"].
- correct_index is the 0-based position of the correct option. Vary where the correct option sits.
- explanation: one or two sentences saying why the correct answer is right, written to help a student who chose wrong.`;

/** Lazily create the client, so a missing key only matters when someone generates questions. */
let client: Anthropic | null = null;
const CREDENTIAL_VARIABLES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID'];

export function generationConfigured(): boolean {
  return CREDENTIAL_VARIABLES.some((name) => Boolean(process.env[name]?.trim()));
}

function anthropic(): Anthropic {
  if (!generationConfigured()) throw notConfigured();
  if (!client) {
    try {
      client = new Anthropic({ timeout: 120_000, maxRetries: 1 });
    } catch {
      throw notConfigured();
    }
  }
  return client;
}

function notConfigured() {
  return new HttpError(503, 'Question generation isn’t set up on this server yet. Add ANTHROPIC_API_KEY to the .env file and restart the server.');
}

/** Pull the text out of a PowerPoint file: every <a:t> run, slide by slide. */
async function pptxText(file: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));

  const decode = (s: string) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  const parts: string[] = [];
  for (const [index, name] of slides.entries()) {
    const xml = await zip.file(name)!.async('string');
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decode(m[1]));
    if (runs.length) parts.push(`Slide ${index + 1}:\n${runs.join(' ')}`);
  }
  return parts.join('\n\n');
}

/** Turn the uploaded file into content blocks for the request. */
export async function materialContent(file: Buffer, ext: string): Promise<Anthropic.ContentBlockParam[]> {
  if (ext === '.pdf') {
    return [{
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: file.toString('base64') },
    }];
  }

  let text: string;
  if (ext === '.md' || ext === '.txt') text = file.toString('utf8');
  else if (ext === '.docx') text = (await mammoth.extractRawText({ buffer: file })).value;
  else if (ext === '.pptx') text = await pptxText(file);
  else throw new HttpError(400, 'Questions can only be generated from PDF, Word, PowerPoint, Markdown or text files.');

  if (text.trim().length < MIN_TEXT_LENGTH) {
    throw new HttpError(422, 'This material has too little text to write a test from. Upload fuller notes and try again.');
  }
  return [{ type: 'text', text: `<material>\n${text}\n</material>` }];
}

/** Keep only well-formed questions, tidied into the shape the database expects. */
export function validQuestions(raw: z.infer<typeof GeneratedQuizSchema>['questions']): GeneratedQuestion[] {
  const result: GeneratedQuestion[] = [];
  for (const q of raw) {
    const prompt = q.prompt.trim();
    const explanation = q.explanation.trim();
    if (!prompt) continue;

    if (q.question_type === 'true_false') {
      if (q.correct_index !== 0 && q.correct_index !== 1) continue;
      result.push({ questionType: 'true_false', prompt, options: ['True', 'False'], correctIndex: q.correct_index, explanation });
      continue;
    }

    const options = q.options.map((o) => o.trim());
    const distinct = new Set(options.map((o) => o.toLowerCase())).size === options.length;
    if (options.length < 2 || options.length > 6 || options.some((o) => !o) || !distinct) continue;
    if (q.correct_index < 0 || q.correct_index >= options.length) continue;
    result.push({ questionType: 'multiple_choice', prompt, options, correctIndex: q.correct_index, explanation });
  }
  return result;
}

export async function generateQuestions(material: {
  file: Buffer;   // the uploaded file's contents
  ext: string;    // its extension, e.g. ".pdf"
  title: string;
  moduleCode: string;
}, count: number): Promise<GeneratedQuestion[]> {
  if (!generationConfigured()) throw notConfigured();
  const content: Anthropic.ContentBlockParam[] = [
    ...(await materialContent(material.file, material.ext)),
    { type: 'text', text: `Material: "${material.title}" (module ${material.moduleCode}).\nWrite exactly ${count} questions.` },
  ];

  let response;
  try {
    response = await anthropic().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // If a safety classifier declines, the API retries on Anthropic's recommended fallback model
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: {
        effort: 'medium', // students wait on this request, so favour speed; quality holds at this level for quiz writing
        format: zodOutputFormat(GeneratedQuizSchema),
      },
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) throw notConfigured();
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'The question service is busy. Wait a minute and try again.');
    if (err instanceof Anthropic.BadRequestError) {
      console.error('Question generation rejected:', err.message);
      throw new HttpError(422, 'This file couldn’t be turned into questions. It may be too large or unreadable.');
    }
    if (err instanceof Anthropic.APIConnectionError) throw new HttpError(503, 'Couldn’t reach the question service. Check the server’s internet connection and try again.');
    if (err instanceof Anthropic.APIError) {
      console.error('Question generation failed:', err.status, err.message);
      throw new HttpError(502, 'The question service had a problem. Try again in a moment.');
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, 'Questions couldn’t be written for this material.');
  }
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
    throw new HttpError(502, 'The questions came back incomplete. Try again, or ask for fewer questions.');
  }

  const questions = validQuestions(response.parsed_output.questions).slice(0, count);
  if (questions.length < Math.min(MIN_QUESTIONS, count)) {
    throw new HttpError(502, 'Too few usable questions came back. Try generating again.');
  }
  return questions;
}

import path from 'path';
import JSZip from 'jszip';
import { HttpError } from './types';

/** The file types materials are stored as, and how they are sent back to the browser. */
export const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const SUPPORTED = 'Upload a PDF, Word (.docx), PowerPoint (.pptx), Markdown or text file.';

const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// Office files from before 2007 (.ppt, .doc, .xls) are all this "compound file" format
const OLD_OFFICE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * Work out what an uploaded file really is from its contents, and return the extension
 * it is stored under (".pdf", ".pptx", ...).
 *
 * The name alone can't be trusted: Windows hides extensions, so an old .ppt can look like
 * a .pptx; slide shows are saved as .ppsx; and files picked on a phone can arrive with no
 * extension at all. Any PowerPoint or Word file in the modern format is accepted whatever
 * it is called, and anything else gets a message saying how to fix it.
 */
export async function detectFileType(originalName: string, content: Buffer): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  if (content.length === 0) throw new HttpError(400, `“${originalName}” is empty.`);

  // PDFs start with "%PDF-", occasionally after a few stray bytes
  if (content.subarray(0, 1024).includes('%PDF-')) return '.pdf';
  if (content.subarray(0, 4).equals(ZIP_SIGNATURE)) return officeType(originalName, content);
  if (content.subarray(0, 8).equals(OLD_OFFICE_SIGNATURE)) throw new HttpError(400, oldOfficeMessage(originalName, ext));

  // Plain text: trust the extension, or accept extension-less files that are clearly text
  if (!content.includes(0)) {
    if (ext === '.md' || ext === '.markdown') return '.md';
    if (ext === '.txt') return '.txt';
    if (ext === '' && isUtf8(content)) return '.txt';
  }
  throw new HttpError(400, `“${originalName}” isn’t a file type the site can open. ${SUPPORTED}`);
}

/** Modern Office files are ZIP archives; the folders inside say which program made them. */
async function officeType(originalName: string, content: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(content);
  } catch {
    throw new HttpError(400, `“${originalName}” looks damaged and can’t be opened. ${SUPPORTED}`);
  }
  const contentTypes = (await zip.file('[Content_Types].xml')?.async('string')) ?? '';
  if (contentTypes.includes('macroEnabled')) {
    throw new HttpError(400, `“${originalName}” contains macros, which can’t be shared with students. Open it and save it as a normal .pptx or .docx file, then upload that.`);
  }
  // Presentations, slide shows (.ppsx) and templates (.potx) all keep their slides under ppt/
  if (zip.file('ppt/presentation.xml')) return '.pptx';
  if (zip.file('word/document.xml')) return '.docx';
  throw new HttpError(400, `“${originalName}” isn’t a file type the site can open. ${SUPPORTED}`);
}

// The name may claim the new format (an old .ppt renamed to .pptx), so match on the start of the extension
function oldOfficeMessage(originalName: string, ext: string): string {
  if (ext.startsWith('.pp') || ext.startsWith('.pot')) {
    return `“${originalName}” is saved in the old PowerPoint format (.ppt). Open it in PowerPoint, choose File › Save As › PowerPoint Presentation (.pptx), then upload that.`;
  }
  if (ext.startsWith('.doc') || ext.startsWith('.dot')) {
    return `“${originalName}” is saved in the old Word format (.doc). Open it in Word, choose File › Save As › Word Document (.docx), then upload that.`;
  }
  return `“${originalName}” is an old Microsoft Office file. Open it and save it as .pptx, .docx or PDF, then upload that.`;
}

function isUtf8(content: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
    return true;
  } catch {
    return false;
  }
}

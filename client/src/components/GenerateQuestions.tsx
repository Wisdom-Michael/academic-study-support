import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, errorMessage } from '../api';
import Notice from './Notice';

export const QUESTION_COUNTS = [5, 10, 15, 20];
export const DEFAULT_QUESTION_COUNT = 10;

export interface GenerateResult {
  added: number;
  totalQuestions: number;
}

/** Ask the server to write a concept check from the material's file. */
export function generateConceptCheck(materialId: number, count: number, replaceExisting: boolean) {
  return api<GenerateResult>(`/materials/${materialId}/concept-check/generate`, {
    method: 'POST',
    body: { count, replaceExisting },
  });
}

export function QuestionCountSelect({ value, onChange, id }: { value: number; onChange: (n: number) => void; id: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {QUESTION_COUNTS.map((n) => <option key={n} value={n}>{n} questions</option>)}
    </select>
  );
}

/** Shown while questions are being written; the request usually takes under a minute. */
export function GeneratingNotice({ count, title }: { count: number; title: string }) {
  return (
    <div className="generating" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div>
        <p className="person-name">Writing {count} questions from “{title}”</p>
        <p className="person-meta">This usually takes under a minute. Keep this page open.</p>
      </div>
    </div>
  );
}

/** On a material's page: generate (or regenerate) its concept check. */
export function GeneratePanel({ materialId, title, existingCount, onGenerated }: {
  materialId: number;
  title: string;
  existingCount: number;
  onGenerated: () => void;
}) {
  const [count, setCount] = useState(DEFAULT_QUESTION_COUNT);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function handleGenerate() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await generateConceptCheck(materialId, count, existingCount > 0 && replace);
      setMessage({
        tone: 'success',
        text: `Added ${result.added} questions. The concept check now has ${result.totalQuestions}.`,
      });
      onGenerated();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel generate-panel">
      <h3><Sparkles size={17} aria-hidden="true" /> Generate questions from this material</h3>
      <p className="muted">
        Questions are written from the uploaded file, with an explanation for each answer.
        Read them through before students take the check.
      </p>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {busy ? (
        <GeneratingNotice count={count} title={title} />
      ) : (
        <>
          <div className="form-row">
            <label className="field field-narrow">
              <span>How many</span>
              <QuestionCountSelect id="generate-count" value={count} onChange={setCount} />
            </label>
          </div>
          {existingCount > 0 && (
            <fieldset className="choice-group">
              <legend>The check already has {existingCount} questions</legend>
              <label className="choice">
                <input type="radio" name="generate-mode" checked={replace} onChange={() => setReplace(true)} />
                <span>Replace them</span>
              </label>
              <label className="choice">
                <input type="radio" name="generate-mode" checked={!replace} onChange={() => setReplace(false)} />
                <span>Add to them</span>
              </label>
            </fieldset>
          )}
          <button type="button" className="button-primary" onClick={handleGenerate}>
            <Sparkles size={16} aria-hidden="true" /> Generate {count} questions
          </button>
        </>
      )}
    </div>
  );
}

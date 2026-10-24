import { FormEvent, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, errorMessage } from '../api';
import { Material } from '../types';
import { DEFAULT_QUESTION_COUNT, generateConceptCheck, GeneratingNotice, QuestionCountSelect } from './GenerateQuestions';
import Notice from './Notice';

interface UploadFormProps {
  knownModules: string[];
  /** Called once the file is saved; `note` reports how creating the concept check went. */
  onUploaded: (material: Material, note: { tone: 'success' | 'error'; text: string }) => void;
  onCancel: () => void;
}

type Step = 'form' | 'uploading' | 'generating';

export default function UploadForm({ knownModules, onUploaded, onCancel }: UploadFormProps) {
  const [title, setTitle] = useState('');
  const [moduleCode, setModuleCode] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [makeTest, setMakeTest] = useState(true);
  const [questionCount, setQuestionCount] = useState(DEFAULT_QUESTION_COUNT);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('form');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Choose a file to upload.');
      return;
    }
    const form = new FormData();
    form.append('title', title);
    form.append('moduleCode', moduleCode);
    form.append('file', file);

    // Step 1: upload the file
    setStep('uploading');
    setError(null);
    let material: Material;
    try {
      material = (await api<{ material: Material }>('/materials', { method: 'POST', form })).material;
    } catch (err) {
      setError(errorMessage(err));
      setStep('form');
      return;
    }

    if (!makeTest) {
      onUploaded(material, { tone: 'success', text: `Uploaded “${material.title}” to ${material.moduleCode}.` });
      return;
    }

    // Step 2: write the concept check from it. The upload stands even if this part fails.
    setStep('generating');
    try {
      const result = await generateConceptCheck(material.materialId, questionCount, false);
      onUploaded(material, {
        tone: 'success',
        text: `Uploaded “${material.title}” with a ${result.totalQuestions}-question concept check.`,
      });
    } catch (err) {
      onUploaded(material, {
        tone: 'error',
        text: `Uploaded “${material.title}”, but its concept check couldn’t be created: ${errorMessage(err)} Open the material to try again.`,
      });
    }
  }

  if (step === 'generating') {
    return (
      <div className="card upload-form">
        <h2>Upload material</h2>
        <GeneratingNotice count={questionCount} title={title} />
      </div>
    );
  }

  return (
    <form className="card upload-form" onSubmit={handleSubmit} noValidate>
      <h2>Upload material</h2>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="form-row">
        <label className="field field-grow">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hash tables and collisions" required />
        </label>
        <label className="field field-narrow">
          <span>Module code</span>
          <input
            value={moduleCode}
            onChange={(e) => setModuleCode(e.target.value.toUpperCase())}
            list="known-modules"
            placeholder="CS201"
            required
          />
          <datalist id="known-modules">
            {knownModules.map((code) => <option key={code} value={code} />)}
          </datalist>
        </label>
      </div>
      <label className="field">
        <span>File</span>
        <input
          type="file"
          accept=".pdf,.md,.txt,.docx,.pptx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-describedby="file-hint"
          required
        />
        <small id="file-hint">PDF, Word, PowerPoint, Markdown or text, up to 20 MB. Markdown and text files track reading progress automatically.</small>
      </label>

      <div className="generate-option">
        <label className="choice">
          <input type="checkbox" checked={makeTest} onChange={(e) => setMakeTest(e.target.checked)} />
          <span><Sparkles size={15} aria-hidden="true" /> Create a concept check from this material</span>
        </label>
        {makeTest && (
          <label className="field field-narrow">
            <span className="sr-only">Number of questions</span>
            <QuestionCountSelect id="upload-question-count" value={questionCount} onChange={setQuestionCount} />
          </label>
        )}
      </div>

      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={step === 'uploading'}>
          {step === 'uploading' ? 'Uploading…' : makeTest ? 'Upload and create test' : 'Upload material'}
        </button>
        <button type="button" className="button-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

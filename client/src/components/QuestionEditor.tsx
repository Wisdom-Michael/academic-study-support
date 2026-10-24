import { FormEvent, useState } from 'react';
import { api, errorMessage } from '../api';
import { QuestionType } from '../types';
import Notice from './Notice';

const EMPTY_OPTIONS = ['', '', '', ''];

/** Faculty form for adding a multiple-choice or true/false question to a chapter's concept check. */
export default function QuestionEditor({ materialId, onAdded }: { materialId: number; onAdded: () => void }) {
  const [questionType, setQuestionType] = useState<QuestionType>('multiple_choice');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<string[]>(EMPTY_OPTIONS);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [explanation, setExplanation] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const shownOptions = questionType === 'true_false' ? ['True', 'False'] : options;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api(`/materials/${materialId}/concept-check/questions`, {
        method: 'POST',
        body: { questionType, prompt, options: shownOptions, correctIndex, explanation },
      });
      setPrompt('');
      setOptions(EMPTY_OPTIONS);
      setCorrectIndex(null);
      setExplanation('');
      setMessage({ tone: 'success', text: 'Question added to the concept check.' });
      onAdded();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="panel question-editor" onSubmit={handleSubmit} noValidate>
      <h3>Add a question</h3>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <fieldset className="choice-group">
        <legend>Question type</legend>
        <label className="choice">
          <input
            type="radio"
            name="question-type"
            checked={questionType === 'multiple_choice'}
            onChange={() => { setQuestionType('multiple_choice'); setCorrectIndex(null); }}
          />
          <span>Multiple choice</span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="question-type"
            checked={questionType === 'true_false'}
            onChange={() => { setQuestionType('true_false'); setCorrectIndex(null); }}
          />
          <span>True or false</span>
        </label>
      </fieldset>

      <label className="field">
        <span>Question</span>
        <textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} required />
      </label>

      <fieldset className="option-editor">
        <legend>Answers: select the correct one</legend>
        {shownOptions.map((option, index) => (
          <div key={index} className="option-editor-row">
            <input
              type="radio"
              name="correct-option"
              aria-label={`Answer ${index + 1} is correct`}
              checked={correctIndex === index}
              onChange={() => setCorrectIndex(index)}
            />
            {questionType === 'true_false' ? (
              <span>{option}</span>
            ) : (
              <input
                aria-label={`Answer ${index + 1}`}
                value={option}
                placeholder={index < 2 ? `Answer ${index + 1}` : `Answer ${index + 1} (optional)`}
                onChange={(e) => setOptions(options.map((o, i) => (i === index ? e.target.value : o)))}
              />
            )}
          </div>
        ))}
      </fieldset>

      <label className="field">
        <span>Explanation shown after answering</span>
        <textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </label>

      <button type="submit" className="button-primary" disabled={saving}>
        {saving ? 'Adding…' : 'Add question'}
      </button>
    </form>
  );
}

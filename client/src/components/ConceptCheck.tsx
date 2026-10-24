import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useUser } from '../auth';
import { useLoad } from '../hooks';
import { ConceptCheck as ConceptCheckData, GradeResult } from '../types';
import { GeneratePanel } from './GenerateQuestions';
import Notice from './Notice';
import QuestionEditor from './QuestionEditor';

interface ConceptCheckProps {
  materialId: number;
  materialTitle: string;
  /** Lecturers and the material's uploader can generate and add questions. */
  canManage: boolean;
  onGraded?: (score: number) => void;
}

function MatchMessage({ result }: { result: GradeResult }) {
  const { match, moduleCode, threshold } = result;
  if (!match) return null;
  if (match.status === 'created') {
    return (
      <Notice>
        Your score is below {threshold}%, so we’ve found someone who can help with {moduleCode}
        {match.helperSummary && <> ({match.helperSummary.charAt(0).toLowerCase() + match.helperSummary.slice(1)})</>} and
        asked if they’re willing. You’ll both get a notification. Once you’ve both accepted, you’ll see each
        other’s name and phone number under <Link to="/student#peer-help">Peer help</Link>.
      </Notice>
    );
  }
  if (match.status === 'already_matched') {
    return (
      <Notice>
        You already have peer help for {moduleCode}. Bring this chapter to your next session; see{' '}
        <Link to="/student#peer-help">Peer help</Link>.
      </Notice>
    );
  }
  return (
    <Notice>
      Nobody who’s doing well in {moduleCode} is free to help right now. We’ll notify you as soon as someone is.
    </Notice>
  );
}

export default function ConceptCheck({ materialId, materialTitle, canManage, onGraded }: ConceptCheckProps) {
  const user = useUser();
  const check = useLoad(
    () => api<{ conceptCheck: ConceptCheckData | null }>(`/materials/${materialId}/concept-check`).then((r) => r.conceptCheck),
    [materialId],
  );
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<GradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isStudent = user.role === 'student';
  const questions = check.data?.questions ?? [];
  const answeredCount = questions.filter((q) => answers[q.questionId] !== undefined).length;
  const allAnswered = questions.length > 0 && answeredCount === questions.length;

  function questionsChanged() {
    setAnswers({});
    setResult(null);
    check.reload();
  }
  const feedbackFor = (questionId: number) => result?.results.find((r) => r.questionId === questionId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const graded = await api<GradeResult>(`/materials/${materialId}/concept-check/submit`, {
        method: 'POST',
        body: { answers },
      });
      setResult(graded);
      onGraded?.(graded.score);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  function tryAgain() {
    setAnswers({});
    setResult(null);
    document.getElementById('concept-check')?.scrollIntoView({ block: 'start' });
  }

  if (check.loading && !check.data) return <p className="muted">Loading concept check…</p>;
  if (check.error) return <Notice tone="error">{check.error}</Notice>;

  return (
    <section id="concept-check" className="card concept-check" aria-labelledby="concept-check-title">
      <h2 id="concept-check-title">{check.data?.title ?? 'Concept check'}</h2>

      {questions.length === 0 ? (
        <p className="muted">
          {canManage
            ? 'This chapter has no concept check yet. Generate one from the material below, or add questions by hand.'
            : 'This chapter doesn’t have a concept check yet.'}
        </p>
      ) : (
        <>
          <p className="lede">
            {isStudent
              ? 'A short, low-stakes check of the main ideas. You’ll see which answers were right straight away, and you can retake it.'
              : 'Students see these questions at the end of the chapter. Answers are only revealed after they submit.'}
          </p>

          <form onSubmit={handleSubmit}>
            <ol className="question-list">
              {questions.map((q) => {
                const feedback = feedbackFor(q.questionId);
                return (
                  <li key={q.questionId} className="question">
                    <fieldset disabled={!isStudent || result !== null}>
                      <legend>{q.prompt}</legend>
                      <div className={q.questionType === 'true_false' ? 'options options-inline' : 'options'}>
                        {q.options.map((option, index) => {
                          const state = feedback
                            ? index === feedback.correctIndex ? 'correct'
                              : index === feedback.chosenIndex ? 'wrong' : ''
                            : '';
                          return (
                            <label key={index} className={`option ${state ? `option-${state}` : ''}`}>
                              <input
                                type="radio"
                                name={`q-${q.questionId}`}
                                checked={answers[q.questionId] === index}
                                onChange={() => setAnswers({ ...answers, [q.questionId]: index })}
                              />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                    {feedback && (
                      <p className={feedback.isCorrect ? 'feedback feedback-correct' : 'feedback feedback-wrong'}>
                        <strong>{feedback.isCorrect ? 'Correct.' : 'Not quite.'}</strong> {feedback.explanation}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>

            {error && <Notice tone="error">{error}</Notice>}

            {isStudent && !result && (
              <div className="form-actions">
                <button type="submit" className="button-primary" disabled={!allAnswered || submitting}>
                  {submitting ? 'Checking…' : 'Check my answers'}
                </button>
                {!allAnswered && (
                  <span className="muted" aria-live="polite">{answeredCount} of {questions.length} answered</span>
                )}
              </div>
            )}
          </form>

          {result && (
            <div className="result" aria-live="polite">
              <p className="result-score">
                <span className={result.score < result.threshold ? 'score-figure score-low' : 'score-figure'}>
                  {result.score}%
                </span>
                {result.correctCount} of {result.totalQuestions} correct
              </p>
              {result.score >= result.threshold && (
                <p>{result.score === 100 ? 'You’ve got this chapter.' : 'A solid grasp. Re-read the explanations for any you missed.'}</p>
              )}
              <MatchMessage result={result} />
              <button type="button" className="button-secondary" onClick={tryAgain}>Retake the check</button>
            </div>
          )}
        </>
      )}

      {canManage && (
        <div className="manage-check">
          <GeneratePanel
            materialId={materialId}
            title={materialTitle}
            existingCount={questions.length}
            onGenerated={questionsChanged}
          />
          <QuestionEditor materialId={materialId} onAdded={questionsChanged} />
        </div>
      )}
    </section>
  );
}

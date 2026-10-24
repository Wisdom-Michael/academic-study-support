import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { ChevronLeft } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { api, apiBlob, errorMessage } from '../api';
import { useUser } from '../auth';
import { fileTypeLabel } from '../format';
import { useLoad } from '../hooks';
import { Material } from '../types';
import ConceptCheck from '../components/ConceptCheck';
import Notice from '../components/Notice';
import { MeterBar, RingMeter } from '../components/charts';

const TEXT_TYPES = ['md', 'txt'];
const SAVE_INTERVAL_MS = 2000;

type LoadedFile =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; url: string }
  | { kind: 'download'; url: string };

// Keyed by material so the tracker starts fresh when moving between chapters
export default function MaterialReaderPage() {
  const materialId = Number(useParams().materialId);
  return <MaterialReader key={materialId} materialId={materialId} />;
}

function MaterialReader({ materialId }: { materialId: number }) {
  const user = useUser();
  const isStudent = user.role === 'student';

  const material = useLoad(
    () => api<{ material: Material }>(`/materials/${materialId}`).then((r) => r.material),
    [materialId],
  );
  const [doc, setDoc] = useState<LoadedFile | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  // --- Load the file itself ---
  const fileType = material.data?.fileType;
  useEffect(() => {
    if (!fileType) return;
    let objectUrl: string | null = null;
    apiBlob(`/materials/${materialId}/file`)
      .then(async (blob) => {
        if (TEXT_TYPES.includes(fileType)) {
          setDoc({ kind: 'text', text: await blob.text() });
        } else {
          objectUrl = URL.createObjectURL(blob);
          setDoc({ kind: fileType === 'pdf' ? 'pdf' : 'download', url: objectUrl });
        }
      })
      .catch((err) => setDocError(errorMessage(err)));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [materialId, fileType]);

  // --- Reading tracker ---
  // `furthest` is how far the student has read; `saved` is what the server last stored.
  const [percent, setPercent] = useState(0);
  const furthest = useRef(0);
  const saved = useRef(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const start = material.data?.progress?.completionPercentage ?? 0;
    furthest.current = Math.max(furthest.current, start);
    saved.current = Math.max(saved.current, start);
    setPercent(furthest.current);
  }, [material.data]);

  const saveProgress = useCallback(async () => {
    const value = Math.round(furthest.current);
    if (!isStudent || value <= saved.current) return;
    try {
      await api(`/materials/${materialId}/progress`, { method: 'PUT', body: { completionPercentage: value } });
      saved.current = value;
      setSaveError(null);
    } catch (err) {
      setSaveError(errorMessage(err));
    }
  }, [isStudent, materialId]);

  const recordProgress = useCallback((value: number) => {
    if (value > furthest.current) {
      furthest.current = value;
      setPercent(value);
    }
  }, []);

  // Text documents: progress follows how far down the page the reader has scrolled
  useEffect(() => {
    if (!isStudent || doc?.kind !== 'text') return;

    function measure() {
      const article = articleRef.current;
      if (!article) return;
      const rect = article.getBoundingClientRect();
      const readTo = window.innerHeight - rect.top;
      recordProgress(Math.max(0, Math.min(100, (readTo / rect.height) * 100)));
    }

    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [isStudent, doc, recordProgress]);

  // Save every couple of seconds while reading, and once more when leaving the page
  useEffect(() => {
    if (!isStudent) return;
    const timer = window.setInterval(saveProgress, SAVE_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      saveProgress();
    };
  }, [isStudent, saveProgress]);

  if (material.error) {
    return (
      <>
        <Notice tone="error">{material.error}</Notice>
        <p><Link to="/materials">Back to course materials</Link></p>
      </>
    );
  }
  if (!material.data) return <p className="muted">Loading…</p>;

  const m = material.data;
  const manualTracking = isStudent && doc !== null && doc.kind !== 'text';

  return (
    <>
      <Link to={`/materials?module=${m.moduleCode}`} className="back-link show-phone">
        <ChevronLeft size={18} aria-hidden="true" /> {m.moduleCode} materials
      </Link>
      <nav className="breadcrumb hide-phone" aria-label="Breadcrumb">
        <Link to="/materials">Course materials</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/materials?module=${m.moduleCode}`}>{m.moduleCode}</Link>
      </nav>

      <div className="reader">
        <div className="reader-body">
          <div className="card reader-card">
            <header className="reader-header">
              <span className="module-tag">{m.moduleCode}</span>
              <h1>{m.title}</h1>
              <p className="row-meta hide-phone">
                {fileTypeLabel[m.fileType] ?? m.fileType.toUpperCase()}, uploaded by {m.uploadedBy}
              </p>
            </header>

            {docError && <Notice tone="error">{docError}</Notice>}
            {!doc && !docError && <p className="muted">Loading the document…</p>}

            {doc?.kind === 'text' && (
              <article ref={articleRef} className="prose">
                {m.fileType === 'md'
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.text}</ReactMarkdown>
                  : <pre className="plain-text">{doc.text}</pre>}
              </article>
            )}
            {doc?.kind === 'pdf' && (
              <iframe className="pdf-frame" src={doc.url} title={m.title} />
            )}
            {doc?.kind === 'download' && (
              <Notice>
                This {fileTypeLabel[m.fileType] ?? 'file'} can’t be shown in the browser.{' '}
                <a href={doc.url} download={`${m.title}.${m.fileType}`}>Download it</a> to read it
                {isStudent ? ', then record how far you’ve got.' : '.'}
              </Notice>
            )}
          </div>

          <ConceptCheck
            materialId={materialId}
            materialTitle={m.title}
            canManage={user.role === 'faculty_admin' || m.uploadedById === user.userId}
            onGraded={() => {
              // Taking the check means the chapter has been read
              recordProgress(100);
              saveProgress();
            }}
          />
        </div>

        {isStudent && (
          <aside className="card tracker" aria-label="Reading progress">
            <h2>Your progress</h2>
            <div className="tracker-ring">
              <RingMeter value={percent} label="Reading progress for this chapter" size={132} stroke={12} />
            </div>
            <div className="tracker-bar">
              <MeterBar value={percent} label="Reading progress for this chapter" />
              <span className="row-value">{Math.round(percent)}%</span>
            </div>
            {manualTracking ? (
              <>
                <p className="muted">Record how far you’ve read.</p>
                <div className="milestones">
                  {[25, 50, 75, 100].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="button-secondary"
                      disabled={percent >= value}
                      onClick={() => { recordProgress(value); saveProgress(); }}
                    >
                      {value === 100 ? 'Finished' : `${value}%`}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">Saved automatically as you read.</p>
            )}
            {saveError && <Notice tone="error">Progress didn’t save: {saveError}</Notice>}
            <a href="#concept-check" className="button-gold button-small tracker-jump">
              <span className="hide-phone">Go to the concept check</span>
              <span className="show-phone">Concept check</span>
            </a>
          </aside>
        )}
      </div>
    </>
  );
}

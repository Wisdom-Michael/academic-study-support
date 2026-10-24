import { FormEvent, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, Presentation, Search, Trash2, Upload } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useUser } from '../auth';
import { fileTypeLabel } from '../format';
import { useLoad } from '../hooks';
import { Material } from '../types';
import { MeterBar } from '../components/charts';
import Notice from '../components/Notice';
import UploadForm from '../components/UploadForm';
import { PageHeader } from '../components/ui';

export default function Repository() {
  const user = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const moduleFilter = searchParams.get('module') ?? '';
  const search = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(search);
  const [showUpload, setShowUpload] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const modules = useLoad(() => api<{ modules: string[] }>('/materials/modules').then((r) => r.modules), []);
  const materials = useLoad(() => {
    const params = new URLSearchParams();
    if (moduleFilter) params.set('module', moduleFilter);
    if (search) params.set('q', search);
    return api<{ materials: Material[] }>(`/materials?${params}`).then((r) => r.materials);
  }, [moduleFilter, search]);

  function updateFilters(next: { module?: string; q?: string }) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    setSearchParams(params, { replace: true });
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    updateFilters({ q: searchInput.trim() });
  }

  async function handleDelete(material: Material) {
    if (!window.confirm(`Delete “${material.title}”? Students’ progress and the concept check for it will be removed too.`)) return;
    try {
      await api(`/materials/${material.materialId}`, { method: 'DELETE' });
      setMessage({ tone: 'success', text: `Deleted “${material.title}”.` });
      materials.reload();
      modules.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  }

  const list = materials.data ?? [];
  const isStudent = user.role === 'student';
  const canDelete = (m: Material) => user.role === 'faculty_admin' || m.uploadedById === user.userId;

  return (
    <>
      <PageHeader
        title="Course materials"
        lede="Lecture notes and reading for each module, each ending with a short concept check."
        actions={!showUpload && (
          <button type="button" className="button-primary" onClick={() => { setShowUpload(true); setMessage(null); }}>
            <Upload size={16} aria-hidden="true" /> Upload<span className="hide-phone"> material</span>
          </button>
        )}
      />

      {showUpload && (
        <UploadForm
          knownModules={modules.data ?? []}
          onCancel={() => setShowUpload(false)}
          onUploaded={(_material, note) => {
            setShowUpload(false);
            setMessage(note);
            materials.reload();
            modules.reload();
          }}
        />
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="card filter-bar">
        <div className="segmented" role="group" aria-label="Filter by module">
          <button type="button" aria-pressed={!moduleFilter} onClick={() => updateFilters({ module: '' })}>All modules</button>
          {(modules.data ?? []).map((code) => (
            <button key={code} type="button" aria-pressed={moduleFilter === code} onClick={() => updateFilters({ module: code })}>
              {code}
            </button>
          ))}
        </div>
        <form className="search-field" role="search" onSubmit={handleSearch}>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search titles"
            placeholder="Search titles"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button type="submit" className="button-gold button-small">Search</button>
        </form>
      </div>

      <div className="results-head">
        <h2 className="results-count">
          {materials.data ? `${list.length} ${list.length === 1 ? 'material' : 'materials'}` : 'Materials'}
          {moduleFilter && <span className="muted"> in {moduleFilter}</span>}
          {search && <span className="muted"> matching “{search}”</span>}
        </h2>
      </div>

      {materials.error && <Notice tone="error">{materials.error}</Notice>}
      {materials.loading && !materials.data && <p className="muted">Loading materials…</p>}
      {materials.data && list.length === 0 && (
        <Notice>
          {moduleFilter || search
            ? 'No materials match these filters. Clear the search or choose another module.'
            : 'No materials yet. Upload the first set of notes for your module.'}
        </Notice>
      )}

      <ul className="material-cards">
        {list.map((m) => {
          const Icon = m.fileType === 'pptx' ? Presentation : FileText;
          const score = m.progress?.scoreAchieved;
          return (
            <li key={m.materialId} className="material-card">
              <span className="file-icon file-icon-lg hide-phone"><Icon size={22} aria-hidden="true" /></span>
              <div className="row-main">
                <span className="module-tag">{m.moduleCode}</span>
                <Link to={`/materials/${m.materialId}`} className="row-title">{m.title}</Link>
                <p className="row-meta">
                  <span className="hide-phone">{fileTypeLabel[m.fileType] ?? m.fileType.toUpperCase()}, uploaded by {m.uploadedBy}. </span>
                  {m.conceptCheck && m.conceptCheck.questionCount > 0 && <>{m.conceptCheck.questionCount}-question concept check</>}
                </p>
              </div>
              {isStudent && (
                <div className="material-progress">
                  <span className="progress-caption">
                    Read <strong>{Math.round(m.progress?.completionPercentage ?? 0)}%</strong>
                    {score != null && (
                      <>, check <strong className={score < 50 ? 'text-critical' : undefined}>{score}%</strong></>
                    )}
                  </span>
                  <MeterBar value={m.progress?.completionPercentage ?? 0} label={`Reading progress for ${m.title}`} />
                </div>
              )}
              <div className="material-actions">
                <Link to={`/materials/${m.materialId}`} className="button-gold button-small">
                  {isStudent && m.progress ? 'Continue' : 'Open'}
                </Link>
                {canDelete(m) && (
                  <button type="button" className="icon-button icon-button-danger" onClick={() => handleDelete(m)} aria-label={`Delete ${m.title}`}>
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

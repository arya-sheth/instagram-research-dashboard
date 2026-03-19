'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, BreakdownItem, LiveCompetitorResearch, LiveResearchResponse } from '../lib/api';

function formatCompact(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a';
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatBreakdown(items: BreakdownItem[]) {
  return items.slice(0, 3).map((item) => `${item.label} (${item.sharePercent}%)`).join(', ') || 'n/a';
}

function formatMetricNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return 'n/a';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function getStageMessage(elapsedSeconds: number) {
  if (elapsedSeconds < 60) return 'Agent 1: validating the exact Instagram handle and finding India-first competitors.';
  if (elapsedSeconds < 180) return 'Agent 2: collecting posts and reels from the target and competitor profiles.';
  if (elapsedSeconds < 300) return 'Agent 3: computing hooks, caption types, posting windows, intervals, and averages.';
  if (elapsedSeconds < 480) return 'Agent 4: assembling the final dashboard payload and ranking competitors.';
  return 'The run is still active, but this is now slower than usual. Large top-10 and 500-item runs can take several extra minutes.';
}

const initialForm = {
  companyName: '',
  instagramHandle: '',
  industry: '',
  notes: '',
  competitorLimit: 4,
  recentPostLimit: 40,
  forceRefresh: true,
};

export default function HomePage() {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState<LiveResearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // For interactive handle confirmation
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [selectedHandles, setSelectedHandles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!loading) {
      setElapsedSeconds(0);
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [loading]);

  const run = async (confirmed?: Array<{ companyName: string; handle: string }>) => {
    setLoading(true);
    setError('');
    setShowConfirmation(false);
    try {
      console.log('[Frontend] Running research with payload:', {
        ...form,
        confirmedCompetitors: confirmed,
      });
      const response = await api.runLiveInstagramResearch({
        ...form,
        forceRefresh: form.forceRefresh ? 1 : 0,
        confirmedCompetitors: confirmed,
      });

      if (response.discovery?.needsConfirmation) {
        setResult(response);
        setShowConfirmation(true);
        // Pre-select the best candidate if available
        const preSelected: Record<string, string> = {};
        response.competitors.forEach(c => {
          if (c.candidates && c.candidates.length > 0) {
            preSelected[c.brandName] = c.candidates[0].handle;
          }
        });
        setSelectedHandles(preSelected);
      } else {
        setResult(response);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run live research');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run();
  };

  const handleConfirmResume = async () => {
    if (!result) return;

    // 1. Get brands that didn't need confirmation (sure brands)
    const sureBrands = result.competitors
      .filter(c => !c.candidates || c.candidates.length === 0)
      .map(c => ({ companyName: c.brandName, handle: c.handle || '' }));

    // 2. Get user-selected handles from the modal (excluding 'SKIP')
    const selectedBrands = Object.entries(selectedHandles)
      .filter(([_, handle]) => handle !== 'SKIP')
      .map(([companyName, handle]) => ({
        companyName,
        handle,
      }));

    // 3. Resume with the full list of validated competitors
    await run([...sureBrands, ...selectedBrands]);
  };

  const stageMessage = getStageMessage(elapsedSeconds);

  return (
    <main className="page-shell">
      <header className="hero card">
        <div>
          <span className="status-pill">Beta v2.1</span>
          <h1>Instagram Research Agent</h1>
          <p className="hero-copy">
            Deep dive into competitor strategies, engagement patterns, and market growth 
            using high-fidelity Instagram data.
          </p>
        </div>
        <div className="hero-panel">
          <span className="eyebrow">System Status</span>
          <p className="small-note">
            Multi-agent pipeline active. 
            Local collector initialized through Playwright.
          </p>
        </div>
      </header>

      <section className="workspace">
        <form className="card form-card" onSubmit={onSubmit}>
          <div className="section-head">
            <h2>Run Live Collection</h2>
            <p>Company name and Instagram handle are both required for the 4-agent live pipeline.</p>
          </div>

          <label>
            Company name
            <input
              required
              placeholder="Enter your company name"
              value={form.companyName}
              onChange={(e) => setForm((current) => ({ ...current, companyName: e.target.value }))}
            />
          </label>

          <label>
            Instagram handle
            <input
              required
              placeholder="Enter your company id"
              value={form.instagramHandle}
              onChange={(e) => setForm((current) => ({ ...current, instagramHandle: e.target.value.replace('@', '') }))}
            />
          </label>

          <label>
            Research notes
            <textarea
              rows={5}
              placeholder="Enter research notes or category details"
              value={form.notes}
              onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
            />
          </label>

          <label>
            Competitors to find: {form.competitorLimit}
            <input
              type="range"
              min={2}
              max={4}
              value={form.competitorLimit}
              onChange={(e) => setForm((current) => ({ ...current, competitorLimit: Number(e.target.value) }))}
            />
          </label>

          <label>
            Collection cap per account: {form.recentPostLimit}
            <input
              type="range"
              min={10}
              max={500}
              step={10}
              value={form.recentPostLimit}
              onChange={(e) => setForm((current) => ({ ...current, recentPostLimit: Number(e.target.value) }))}
            />
          </label>
          {form.competitorLimit >= 4 || form.recentPostLimit > 40 ? (
            <p className="small-note">
              For the current live collector, the strongest results usually come from 3-4 competitors and 20-40 items per account.
            </p>
          ) : null}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.forceRefresh}
              onChange={(e) => setForm((current) => ({ ...current, forceRefresh: e.target.checked }))}
            />
            Force fresh collection instead of cached result
          </label>

          <button type="submit" disabled={loading}>{loading ? 'Running 4-agent pipeline...' : 'Run live Instagram research'}</button>
          {loading ? (
            <div className="status-note">
              <p><strong>Live status:</strong> {stageMessage}</p>
              <p><strong>Elapsed:</strong> {formatElapsed(elapsedSeconds)}</p>
              <p>For a top-10 run with a 500-item cap, waiting more than 7 minutes can still be normal.</p>
            </div>
          ) : null}
          {error ? <p className="error-text">{error}</p> : null}
        </form>

        <div className="results-stack">
          <section className="card target-card">
            <div className="section-head">
              <h2>Collection Status</h2>
              <p>{loading ? stageMessage : result?.collection.summary ?? 'No live run yet.'}</p>
            </div>
            <div className="target-grid">
              <div>
                {result?.target.screenshotPath ? (
                  <img className="preview-avatar preview-avatar-lg" src={result.target.screenshotPath} alt="Target profile" />
                ) : null}
                <p className="eyebrow">Target</p>
                <h3>{result?.target.brandName ?? form.companyName}</h3>
                <p className="muted">@{result?.target.handle ?? form.instagramHandle}</p>
                {result?.target.profileUrl ? (
                  <a href={result.target.profileUrl} target="_blank" rel="noreferrer">
                    Open Instagram profile
                  </a>
                ) : null}
              </div>
              <div>
                <p><strong>Followers:</strong> {loading && !result ? 'Collecting...' : formatCompact(result?.target.followers)}</p>
                <p><strong>Bio:</strong> {result?.target.bio ?? (loading ? 'Collecting...' : '-')}</p>
              </div>
            </div>
          </section>

          <section className="metrics-grid">
            <article className="metric-card">
              <span className="eyebrow">Competitors analyzed</span>
              <strong>{result?.marketSummary.competitorCount ?? 0}</strong>
              <p>Validated and analyzed from public pages in this run.</p>
            </article>
            <article className="metric-card">
              <span className="eyebrow">Average views</span>
              <strong>{formatCompact(result?.marketSummary.averageViewsAcrossCompetitors)}</strong>
              <p>Average post views across collected competitor samples.</p>
            </article>
            <article className="metric-card">
              <span className="eyebrow">Best windows</span>
              <strong>{result?.marketSummary.bestPostingWindows.slice(0, 2).join(' | ') || 'n/a'}</strong>
              <p>Most repeated time windows from collected post timestamps.</p>
            </article>
          </section>

          <section className="card recommendations-card">
            <div className="section-head">
              <h2>Prioritized Recommendations</h2>
              <p>Actionable strategy based on competitor content and performance.</p>
            </div>
            <div className="recommend-grid">
              {(result?.recommendations.priorities ?? []).map((p, idx) => (
                <div key={idx} className="chip">{p}</div>
              ))}
              {!result?.recommendations.priorities.length && <p className="muted">Detailed recommendations will appear here after full analysis.</p>}
            </div>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>India-First Competitor Ranking</h2>
              <p>Sorted by market presence, ASP overlap, and engagement on public profiles.</p>
            </div>
            <div className="competitor-grid">
              {result?.competitors.map((comp) => (
                <article key={comp.id} className="competitor-card">
                  <div className="competitor-top">
                    <div className="competitor-heading">
                      {comp.screenshotPath ? (
                        <img className="preview-avatar" src={comp.screenshotPath} alt={comp.brandName} />
                      ) : (
                        <div className="preview-avatar-placeholder" />
                      )}
                      <div>
                        <h3>{comp.brandName}</h3>
                        <p className="muted">
                          {comp.handle && comp.handle !== 'null' ? (
                            <span>@{comp.handle}</span>
                          ) : (
                            <span className="unsure-label">Unsure ID</span>
                          )}
                        </p>
                      </div>
                    </div>
                    {comp.verified && <span className="verified-badge">✓</span>}
                  </div>
                  <div className="competitor-bio-box">
                    <p className="small-note">{comp.bio}</p>
                  </div>
                  <div className="stats-list">
                    <p><strong>Followers:</strong> {formatCompact(comp.followerCount)}</p>
                    <p><strong>Posts:</strong> {formatCompact(comp.postCount)}</p>
                    <p><strong>Avg views:</strong> {formatCompact(comp.metrics.averageViews)}</p>
                    <p><strong>Avg comments:</strong> {formatMetricNumber(comp.metrics.averageComments)}</p>
                    <p><strong>Interval:</strong> {comp.postingCadence.averageIntervalHours ? `${comp.postingCadence.averageIntervalHours.toFixed(2)} hrs` : 'n/a'}</p>
                    <p><strong>Media mix:</strong> {formatBreakdown(comp.mix.mediaTypes)}</p>
                    <p><strong>Hook mix:</strong> {formatBreakdown(comp.mix.hookTypes)}</p>
                    <p><strong>Caption mix:</strong> {formatBreakdown(comp.mix.captionTypes)}</p>
                  </div>
                  {comp.profileUrl && comp.handle && comp.handle !== 'null' && (
                    <a href={comp.profileUrl} target="_blank" rel="noreferrer" className="small-link">
                      Open profile
                    </a>
                  )}
                </article>
              ))}
              {!result?.competitors.length && !loading && (
                <p className="empty-state">No competitors found for this brand yet.</p>
              )}
            </div>
          </section>
        </div>
      </section>

      {showConfirmation && result && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="section-head">
              <h2>Confirm Competitor Handles</h2>
              <p>For these brands, Agent 1 found multiple possible accounts. Please confirm which one to proceed with, or skip if none match.</p>
            </div>
            <div className="confirmation-list">
              {result.competitors.filter(c => c.candidates && c.candidates.length > 0).map((competitor) => (
                <div key={competitor.brandName} className="confirmation-item">
                  <h3>{competitor.brandName}</h3>
                  <div className="candidate-grid">
                    {competitor.candidates?.map((candidate) => (
                      <div
                        key={candidate.handle}
                        className={`candidate-tag ${selectedHandles[competitor.brandName] === candidate.handle ? 'selected' : ''}`}
                        onClick={() => setSelectedHandles(curr => ({ ...curr, [competitor.brandName]: candidate.handle }))}
                      >
                        <div className="candidate-info">
                          <strong>@{candidate.handle}</strong>
                          <p className="small-note">{formatCompact(candidate.followers)} followers • {candidate.verified ? 'Verified' : 'Public'}</p>
                          <p className="tiny-note">{candidate.fullName}</p>
                        </div>
                      </div>
                    ))}
                    <div
                      key="SKIP"
                      className={`candidate-tag ${selectedHandles[competitor.brandName] === 'SKIP' ? 'selected' : ''}`}
                      onClick={() => setSelectedHandles(curr => ({ ...curr, [competitor.brandName]: 'SKIP' }))}
                    >
                      <div className="candidate-info">
                        <strong>None of these</strong>
                        <p className="small-note">Skip this brand for now</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button disabled={loading} onClick={handleConfirmResume} className="primary-btn">
                {loading ? 'Continuing...' : 'Confirm & Continue Research'}
              </button>
              <button disabled={loading} onClick={() => setShowConfirmation(false)}>Back</button>
            </div>
          </div>
        </div>
      )}


      {/* Styles for the modal and new elements */}
      <style jsx>{`
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(36, 23, 15, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(8px);
        }
        .modal-card {
          background: var(--card);
          border: 1px solid var(--line);
          padding: 32px;
          border-radius: 24px;
          max-width: 800px;
          width: min(90%, 800px);
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: var(--shadow);
        }
        .confirmation-list {
          margin: 24px 0;
          display: grid;
          gap: 24px;
        }
        .confirmation-item h3 {
          margin-bottom: 12px;
          color: var(--ink);
          font-size: 1.15rem;
          font-family: 'Trebuchet MS', 'Segoe UI', sans-serif;
        }
        .candidate-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 12px;
        }
        .candidate-tag {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 14px;
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 16px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .candidate-tag:hover {
          background: var(--card);
          border-color: var(--accent);
        }
        .candidate-tag.selected {
          border-color: var(--accent-strong);
          background: var(--accent-soft);
        }
        .candidate-info strong {
          display: block;
          color: var(--ink);
          margin-bottom: 2px;
        }
        .small-note { font-size: 0.85rem; color: var(--muted); }
        .tiny-note { font-size: 0.75rem; color: var(--muted); opacity: 0.7; }
        .modal-actions {
          display: flex;
          gap: 12px;
          margin-top: 24px;
          justify-content: flex-end;
          border-top: 1px solid var(--line);
          padding-top: 20px;
        }
        .primary-btn {
          background: linear-gradient(135deg, var(--accent), var(--accent-strong));
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 16px;
          font-weight: 700;
          cursor: pointer;
        }
        .primary-btn:hover { transform: translateY(-1px); }
        .unsure-label {
          color: var(--accent);
          font-weight: 700;
          font-size: 0.85rem;
        }
      `}</style>
    </main>
  );
}

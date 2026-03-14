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

function formatSelectionReasons(signals: string[]) {
  const preferred = signals.filter((signal) =>
    /website|email|exact username|username contains brand|profile website matches brand domain|profile full name matches brand/i.test(signal),
  );
  return (preferred.length ? preferred : signals).slice(0, 4);
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
  companyName: 'Plum Insurance',
  instagramHandle: 'plumhq',
  industry: '',
  notes:
    'Discovery Agent finds India-first business competitors, Collection Agent gathers posts + reels, Insight Agent analyzes hooks, captions, timing, and Dashboard Agent shows the final research.',
  competitorLimit: 10,
  recentPostLimit: 500,
  forceRefresh: true,
};

export default function HomePage() {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState<LiveResearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

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

  const run = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.runLiveInstagramResearch({
        ...form,
        forceRefresh: form.forceRefresh ? 1 : 0,
      });
      setResult(response);
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

  const stageMessage = getStageMessage(elapsedSeconds);

  return (
    <main className="page-shell">
      <section className="hero card">
        <div>
          <p className="eyebrow">Live Instagram Research Pipeline</p>
          <h1>Target handle in. Real public-page competitor research out.</h1>
          <p className="hero-copy">
            The system now runs as a 4-agent pipeline: Discovery Agent finds India-first business competitors and
            official handles, Collection Agent pulls posts + reels, Insight Agent computes hooks and cadence, and
            Dashboard Agent renders the final research.
          </p>
        </div>
        <div className="hero-panel">
          <span className="status-pill">{loading ? 'running 4-agent pipeline' : result?.sourceMode ?? 'ready'}</span>
          <p>
            Large runs can take a few minutes because the dashboard validates handles, collects live Instagram items,
            and then computes aggregate competitor insights before rendering.
          </p>
          {loading ? (
            <p><strong>Elapsed:</strong> {formatElapsed(elapsedSeconds)}</p>
          ) : null}
        </div>
      </section>

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
              value={form.companyName}
              onChange={(e) => setForm((current) => ({ ...current, companyName: e.target.value }))}
            />
          </label>

          <label>
            Instagram handle
            <input
              required
              value={form.instagramHandle}
              onChange={(e) => setForm((current) => ({ ...current, instagramHandle: e.target.value.replace('@', '') }))}
            />
          </label>

          <label>
            Research notes
            <textarea
              rows={5}
              value={form.notes}
              onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
            />
          </label>

          <label>
            Competitors to analyze: {form.competitorLimit}
            <input
              type="range"
              min={2}
              max={10}
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
                <p><strong>Category:</strong> {result?.target.category ?? (loading ? 'Collecting...' : '-')}</p>
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
              <span className="eyebrow">Average reel views</span>
              <strong>{formatCompact(result?.marketSummary.averageReelViewsAcrossCompetitors)}</strong>
              <p>Useful benchmark for short-form performance.</p>
            </article>
            <article className="metric-card">
              <span className="eyebrow">Best windows</span>
              <strong>{result?.marketSummary.bestPostingWindows.slice(0, 2).join(' | ') || 'n/a'}</strong>
              <p>Most repeated time windows from collected post timestamps.</p>
            </article>
          </section>

        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Competitor Deep Dive</h2>
          <p>These cards are generated from the 4-agent pipeline outputs for the current run.</p>
        </div>
        <div className="competitor-grid">
          {result?.competitors.map((competitor: LiveCompetitorResearch) => (
            <article className="competitor-card" key={competitor.id}>
              <div className="competitor-top">
                <div className="competitor-heading">
                  {competitor.screenshotPath ? (
                    <img className="preview-avatar" src={competitor.screenshotPath} alt={`${competitor.brandName} profile`} />
                  ) : null}
                  <div>
                  <h3>{competitor.brandName}</h3>
                  <p className="muted">@{competitor.handle}</p>
                  </div>
                </div>
              </div>
              <p>{competitor.bio}</p>
              {competitor.about && competitor.about !== competitor.bio ? (
                <p className="small-note">{competitor.about}</p>
              ) : null}
              <div className="chip-row">
                {competitor.contentPillars.map((item) => (
                  <span className="chip" key={item}>{item}</span>
                ))}
              </div>
              <div className="stats-list">
                <p><strong>Followers:</strong> {formatCompact(competitor.followerCount)}</p>
                <p><strong>Posts:</strong> {formatCompact(competitor.postCount)}</p>
                <p><strong>Avg views:</strong> {formatCompact(competitor.metrics.averageViews)}</p>
                <p><strong>Avg reel views:</strong> {formatCompact(competitor.metrics.averageReelViews)}</p>
                <p><strong>Avg comments:</strong> {formatMetricNumber(competitor.metrics.averageComments)}</p>
                <p><strong>Avg duration:</strong> {competitor.metrics.averageDurationSec ?? 'n/a'}s</p>
                <p><strong>Interval:</strong> {competitor.postingCadence.averageIntervalHours} hrs</p>
                <p><strong>Windows:</strong> {competitor.postingCadence.preferredWindows.join(', ') || 'n/a'}</p>
                <p><strong>Media mix:</strong> {formatBreakdown(competitor.mix.mediaTypes)}</p>
                <p><strong>Hook mix:</strong> {formatBreakdown(competitor.mix.hookTypes)}</p>
                <p><strong>Content mix:</strong> {formatBreakdown(competitor.mix.contentTypes)}</p>
                <p><strong>Caption mix:</strong> {formatBreakdown(competitor.mix.captionTypes)}</p>
              </div>
              <div className="selection-reason-box">
                <p><strong>Selected because</strong></p>
                <ul className="selection-reason-list">
                  {formatSelectionReasons(competitor.signals).map((signal) => (
                    <li key={`${competitor.id}-${signal}`}>{signal}</li>
                  ))}
                </ul>
              </div>
              <a href={competitor.profileUrl} target="_blank" rel="noreferrer">Open profile</a>
            </article>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Top Captured Post Samples</h2>
          <p>Best-performing post samples from the current run, including screenshot artifacts.</p>
        </div>
        <div className="post-grid">
          {result?.marketSummary.bestPerformingPostSamples.map((post) => (
            <article className="post-card" key={post.id}>
              <div className="post-card-top">
                {post.screenshotPath ? (
                  <img className="preview-avatar preview-thumb" src={post.screenshotPath} alt={post.thumbnailLabel} />
                ) : (
                  <div className="thumbnail-box thumbnail-box-sm">{post.thumbnailLabel}</div>
                )}
              <div className="post-body">
                <p className="eyebrow">{post.mediaType} • {post.contentType}</p>
                <h3>{formatCompact(post.views)} views</h3>
                <p><strong>Hook:</strong> {post.hookType}</p>
                <p><strong>Caption type:</strong> {post.captionType}</p>
                <p><strong>Duration:</strong> {post.durationSec ?? 'n/a'} sec</p>
                <p><strong>Comments:</strong> {post.comments ?? 'n/a'}</p>
                <p>{post.captionPreview}</p>
                <a href={post.url} target="_blank" rel="noreferrer">Open post</a>
              </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

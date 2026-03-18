#!/usr/bin/env node
/**
 * Generate a static HTML dashboard from the last hygiene run.
 * Reads:  data/last-run.json   (written by src/index.js after every run)
 * Writes: docs/index.html      (committed by GitHub Actions → served via GitHub Pages)
 *
 * Run manually: node scripts/generate-dashboard.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_FILE = join(ROOT, 'data', 'last-run.json');
const OUT_FILE = join(ROOT, 'docs', 'index.html');

// ---------------------------------------------------------------------------
// Load run data
// ---------------------------------------------------------------------------

if (!existsSync(DATA_FILE)) {
  console.error('No data/last-run.json found. Run `npm start` first.');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
} catch (e) {
  console.error('Failed to parse data/last-run.json:', e.message);
  process.exit(1);
}

const { generatedAt, runType, results = [], remResults = [], orgConfig = [] } = data;
const regionByAlias = Object.fromEntries(orgConfig.map((o) => [o.alias, o.region || '']));
const allPass = results.every((r) => r.pass);
const passCount = results.filter((r) => r.pass).length;
const failCount = results.length - passCount;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return 'Unknown';
  return new Date(iso).toUTCString().replace(/ GMT$/, ' UTC');
}

function fmtNextRun(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  d.setDate(d.getDate() + 3);
  return d.toUTCString().replace(/ GMT$/, ' UTC');
}

// Derive GitHub Actions workflow URL from git remote so the "Run now" button
// always points to the right repo without hardcoding.
function getActionsUrl() {
  try {
    const cfg = readFileSync(join(ROOT, '.git', 'config'), 'utf-8');
    const m = cfg.match(/url\s*=\s*(?:https:\/\/github\.com\/|git@github\.com:)([^\s]+?)(?:\.git)?\s/);
    if (m) return `https://github.com/${m[1]}/actions/workflows/hygiene-check.yml`;
  } catch {}
  return 'https://github.com';
}

const actionsUrl = getActionsUrl();

// ---------------------------------------------------------------------------
// Per-org rendering
// ---------------------------------------------------------------------------

function renderMetrics(result) {
  const d = result.details || {};
  const t = result._thresholds || {};
  const minOpps   = t?.opportunities?.minCurrentMonth ?? 8;
  const minOmega  = t?.opportunities?.minOmega ?? 2;
  const minEvents = t?.events?.minCount ?? 5;
  const eventDays = t?.events?.minUpcomingDays ?? 14;
  const requireAll = t?.activity?.requireAllCurrentQuarterForAgent !== false;

  const metrics = [
    {
      label: 'Pipeline (month)',
      value: d.opportunitiesCurrentMonth != null ? `${d.opportunitiesCurrentMonth} opps` : 'N/A',
      threshold: `≥${minOpps} required`,
      pass: d.opportunitiesCurrentMonth != null ? d.opportunitiesCurrentMonth >= minOpps : null,
    },
    {
      label: 'Omega opps',
      value: d.opportunitiesOmegaCurrentMonth != null ? String(d.opportunitiesOmegaCurrentMonth) : 'N/A',
      threshold: `≥${minOmega} required`,
      pass: d.opportunitiesOmegaCurrentMonth != null ? d.opportunitiesOmegaCurrentMonth >= minOmega : null,
    },
    {
      label: 'Omega flagship',
      value: d.omegaFlagshipOpen === true ? 'Present' : d.omegaFlagshipOpen === false ? 'Missing' : 'N/A',
      threshold: 'Must be open',
      pass: d.omegaFlagshipOpen ?? null,
    },
    {
      label: `Events (next ${eventDays}d)`,
      value: d.eventsUpcoming != null ? String(d.eventsUpcoming) : 'N/A',
      threshold: `≥${minEvents} required`,
      pass: d.eventsUpcoming != null ? d.eventsUpcoming >= minEvents : null,
    },
    {
      label: 'Omega activity',
      value: d.activityOmegaOk === true ? 'All active' : d.activityOmegaOk === false ? 'Stale' : 'N/A',
      threshold: 'Last 30 days',
      pass: d.activityOmegaOk ?? null,
    },
    {
      label: 'Agent-ready (qtr)',
      value: d.openCurrentQuarterTotal != null
        ? `${d.openCurrentQuarterWithActivity ?? 0}/${d.openCurrentQuarterTotal} opps`
        : 'N/A',
      threshold: requireAll ? 'All need activity' : `≥${minOmega} need activity`,
      pass: d.agentActivityReady ?? null,
    },
  ];

  return metrics
    .map((m) => {
      const cls = m.pass === true ? 'metric-pass' : m.pass === false ? 'metric-fail' : 'metric-na';
      const icon = m.pass === true ? '✓' : m.pass === false ? '✗' : '–';
      return `
        <div class="metric ${cls}">
          <div class="metric-icon">${icon}</div>
          <div class="metric-body">
            <div class="metric-label">${escHtml(m.label)}</div>
            <div class="metric-value">${escHtml(m.value)}</div>
            <div class="metric-threshold">${escHtml(m.threshold)}</div>
          </div>
        </div>`;
    })
    .join('');
}

function renderFailures(failures) {
  const real = (failures || []).filter((f) => !f.startsWith('Remediation ran'));
  if (!real.length) return '';
  const items = real.map((f) => `<li>${escHtml(f)}</li>`).join('');
  return `
      <div class="failures">
        <strong>What failed:</strong>
        <ul>${items}</ul>
      </div>`;
}

function renderRemediation(rem) {
  if (!rem) return '';
  if (rem.errors && rem.errors.length) {
    const items = rem.errors.map((e) => `<li>${escHtml(e)}</li>`).join('');
    return `
      <div class="rem-error">
        <strong>Remediation errors — check org manually:</strong>
        <ul>${items}</ul>
      </div>`;
  }
  const fixed = [];
  if (rem.opportunitiesCreated) fixed.push('Moved opps to current month');
  if (rem.eventsCreated)        fixed.push('Added upcoming events');
  if (rem.activityCreated)      fixed.push('Added activity to Omega opps');
  if (rem.notesCreated)         fixed.push('Added notes to opps');
  if (rem.flowStarted)          fixed.push('Refreshed Pipeline Management flow');
  if (!fixed.length) return '';
  const items = fixed.map((f) => `<li>${f}</li>`).join('');
  return `
      <div class="rem-ok">
        <strong>Auto-fixed:</strong>
        <ul>${items}</ul>
      </div>`;
}

function renderOrgCards() {
  return results
    .map((r, i) => {
      const region = regionByAlias[r.orgAlias] || '';
      const rem = remResults[i] || null;
      const passClass = r.pass ? 'card-pass' : 'card-fail';
      const badge = r.pass
        ? '<span class="badge badge-pass">PASS</span>'
        : '<span class="badge badge-fail">FAIL</span>';

      return `
    <div class="card ${passClass}">
      <div class="card-header">
        <div class="card-title">
          <span class="org-alias">${escHtml(r.orgAlias)}</span>
          ${region ? `<span class="org-region">${escHtml(region)}</span>` : ''}
        </div>
        ${badge}
      </div>
      <div class="metrics-grid">
        ${renderMetrics(r)}
      </div>
      ${renderFailures(r.failures)}
      ${renderRemediation(rem)}
    </div>`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Demo Org Hygiene${allPass ? ' ✓' : ' ✗'}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f1f5f9;
    color: #0f172a;
    min-height: 100vh;
    padding: 28px 16px 56px;
  }

  /* ── Page header ── */
  .page-header { max-width: 860px; margin: 0 auto 28px; }

  .page-header h1 {
    font-size: 1.4rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .status-dot {
    width: 13px; height: 13px; border-radius: 50%; flex-shrink: 0;
  }
  .dot-pass { background: #16a34a; box-shadow: 0 0 0 3px #dcfce7; }
  .dot-fail { background: #dc2626; box-shadow: 0 0 0 3px #fee2e2; }

  .summary-row {
    display: flex; align-items: center; gap: 10px;
    margin-top: 10px; flex-wrap: wrap;
  }
  .tag {
    font-size: 0.75rem; font-weight: 600; padding: 3px 10px;
    border-radius: 9999px;
  }
  .tag-pass  { background: #dcfce7; color: #15803d; }
  .tag-fail  { background: #fee2e2; color: #b91c1c; }
  .tag-muted { background: #e2e8f0; color: #475569; }

  .meta {
    margin-top: 10px; font-size: 0.8rem; color: #64748b;
    display: flex; flex-wrap: wrap; gap: 4px 20px;
  }

  .run-btn {
    display: inline-flex; align-items: center; gap: 6px;
    margin-top: 14px; padding: 7px 16px;
    background: #0f172a; color: #fff;
    border-radius: 6px; text-decoration: none;
    font-size: 0.8125rem; font-weight: 500;
  }
  .run-btn:hover { background: #1e293b; }

  /* ── Cards ── */
  .cards {
    max-width: 860px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 18px;
  }

  .card {
    background: #fff;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(0,0,0,.05);
    overflow: hidden;
  }
  .card-pass { border-left: 4px solid #16a34a; }
  .card-fail { border-left: 4px solid #dc2626; }

  .card-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px 12px;
    border-bottom: 1px solid #f1f5f9;
  }
  .card-title { display: flex; align-items: center; gap: 9px; }
  .org-alias  { font-size: 1rem; font-weight: 700; }
  .org-region {
    font-size: 0.6875rem; font-weight: 700; padding: 2px 8px;
    border-radius: 9999px; background: #f1f5f9; color: #475569;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .badge {
    font-size: 0.6875rem; font-weight: 700; padding: 4px 11px;
    border-radius: 9999px; letter-spacing: 0.04em;
  }
  .badge-pass { background: #dcfce7; color: #15803d; }
  .badge-fail { background: #fee2e2; color: #b91c1c; }

  /* ── Metrics grid ── */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 1px;
    background: #f1f5f9;
  }

  .metric {
    background: #fff; padding: 13px 14px;
    display: flex; align-items: flex-start; gap: 8px;
  }
  .metric-icon {
    font-size: 0.875rem; font-weight: 700;
    width: 18px; flex-shrink: 0; padding-top: 1px;
  }
  .metric-pass .metric-icon { color: #16a34a; }
  .metric-fail .metric-icon { color: #dc2626; }
  .metric-na   .metric-icon { color: #94a3b8; }

  .metric-label {
    font-size: 0.625rem; font-weight: 700; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 3px;
  }
  .metric-value {
    font-size: 0.9375rem; font-weight: 600; color: #0f172a; margin-bottom: 2px;
  }
  .metric-threshold { font-size: 0.625rem; color: #94a3b8; }

  /* ── Failures / remediation ── */
  .failures, .rem-ok, .rem-error {
    margin: 14px 18px;
    border-radius: 7px;
    padding: 11px 14px;
    font-size: 0.8125rem;
  }
  .failures   { background: #fef2f2; border: 1px solid #fecaca; color: #7f1d1d; }
  .rem-ok     { background: #f0fdf4; border: 1px solid #bbf7d0; color: #14532d; }
  .rem-error  { background: #fffbeb; border: 1px solid #fde68a; color: #78350f; }

  .failures strong  { display: block; margin-bottom: 5px; color: #b91c1c; }
  .rem-ok strong    { display: block; margin-bottom: 5px; color: #15803d; }
  .rem-error strong { display: block; margin-bottom: 5px; color: #b45309; }

  .failures ul, .rem-ok ul, .rem-error ul { padding-left: 16px; }
  .failures li, .rem-ok li, .rem-error li { margin-top: 3px; line-height: 1.4; }

  /* ── Footer ── */
  .page-footer {
    max-width: 860px; margin: 32px auto 0;
    font-size: 0.75rem; color: #94a3b8; text-align: center;
  }
  .page-footer a { color: #94a3b8; text-underline-offset: 2px; }

  @media (max-width: 480px) {
    .metrics-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>

<div class="page-header">
  <h1>
    <span class="status-dot ${allPass ? 'dot-pass' : 'dot-fail'}"></span>
    Demo Org Hygiene
  </h1>
  <div class="summary-row">
    ${passCount > 0 ? `<span class="tag tag-pass">${passCount} passing</span>` : ''}
    ${failCount > 0 ? `<span class="tag tag-fail">${failCount} failing</span>` : ''}
    <span class="tag tag-muted">${escHtml(runType || 'auto-remediate')}</span>
  </div>
  <div class="meta">
    <span>Last run: ${escHtml(fmtDate(generatedAt))}</span>
    <span>Est. next run: ${escHtml(fmtNextRun(generatedAt))}</span>
  </div>
  <a class="run-btn" href="${escHtml(actionsUrl)}" target="_blank" rel="noopener">
    &#9654; Run now (GitHub Actions)
  </a>
</div>

<div class="cards">
  ${renderOrgCards()}
</div>

<div class="page-footer">
  <p>Auto-generated by <a href="${escHtml(actionsUrl.replace('/actions/workflows/hygiene-check.yml', ''))}">demo-org-hygiene-agent</a> &middot; Scheduled every 3 days via GitHub Actions</p>
</div>

</body>
</html>`;

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(OUT_FILE, html, 'utf-8');
console.log('✓ Dashboard written to docs/index.html');

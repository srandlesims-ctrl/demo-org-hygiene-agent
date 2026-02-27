/**
 * Hygiene check engine: run SOQL checks against an org via Salesforce CLI.
 */

import { execSync } from 'child_process';

/**
 * Run a SOQL query against an org and return the JSON result.
 * @param {string} orgAlias - Target org alias
 * @param {string} query - SOQL query
 * @returns {{ records: array, totalSize: number } | { error: string }}
 */
export function runSoql(orgAlias, query) {
  try {
    const out = execSync(`sf data query --query "${query.replace(/"/g, '\\"')}" --target-org ${orgAlias} --json`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
    const data = JSON.parse(out);
    if (data.status === 0 && data.result?.records !== undefined) {
      return { records: data.result.records, totalSize: data.result.totalSize ?? data.result.records.length };
    }
    return { error: data.message || 'Query failed' };
  } catch (e) {
    let msg = e.stderr?.toString() || e.stdout?.toString() || e.message;
    try {
      const parsed = JSON.parse(e.stdout || '{}');
      if (parsed.message) msg = parsed.message;
    } catch (_) {}
    return { error: msg.trim() };
  }
}

/**
 * Get first day of current month (YYYY-MM-DD) and first day of next month in org's timezone.
 * We use UTC for SOQL; caller can pass year/month for flexibility.
 */
function getCurrentMonthBounds() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const firstDay = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lastDayNum = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lastDay = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;
  return {
    firstDay,
    lastDay,
    year: y,
    month: m + 1,
  };
}

/**
 * Run all hygiene checks for one org.
 * @param {string} orgAlias - Target org alias
 * @param {{ minCurrentMonth: number, minUpcomingDays: number, minCount: number }} thresholds
 * @returns {Promise<import('./evaluator.js').CheckResult>}
 */
export async function runHygieneChecks(orgAlias, thresholds) {
  const month = getCurrentMonthBounds();
  const results = {
    orgAlias,
    opportunitiesCurrentMonth: null,
    eventsUpcoming: null,
    errors: [],
  };

  // Opportunities with Close Date in current month (open, not closed)
  const oppQuery = `SELECT COUNT() FROM Opportunity WHERE CloseDate >= ${month.firstDay} AND CloseDate <= ${month.lastDay} AND IsClosed = false`;
  const oppResult = runSoql(orgAlias, oppQuery);
  if (oppResult.error) {
    results.errors.push(`Opportunities: ${oppResult.error}`);
  } else {
    const row = oppResult.records?.[0];
    const count = oppResult.totalSize ?? row?.expr0 ?? row?.count ?? 0;
    results.opportunitiesCurrentMonth = Number(count);
  }

  // Events in the next N days
  const days = thresholds?.events?.minUpcomingDays ?? 14;
  const eventQuery = `SELECT COUNT() FROM Event WHERE StartDateTime >= TODAY AND StartDateTime <= NEXT_N_DAYS:${days}`;
  const eventResult = runSoql(orgAlias, eventQuery);
  if (eventResult.error) {
    results.errors.push(`Events: ${eventResult.error}`);
  } else {
    const row = eventResult.records?.[0];
    const count = eventResult.totalSize ?? row?.expr0 ?? row?.count ?? 0;
    results.eventsUpcoming = Number(count);
  }

  return results;
}

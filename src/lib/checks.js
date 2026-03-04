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
    if (data.status !== 0) {
      return { error: data.message || 'Query failed' };
    }
    const result = data.result ?? {};
    const records = result.records ?? [];
    // COUNT() queries may return only totalSize or a single record with expr0; normalize so callers get both
    const raw =
      result.totalSize ??
      (records[0] && (records[0].expr0 !== undefined ? records[0].expr0 : records[0].count)) ??
      records.length;
    const totalSize = Number(raw);
    return { records, totalSize: Number.isNaN(totalSize) ? 0 : totalSize };
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
 * Get first/last day of current month (UTC) for SOQL.
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

/** Get first/last day of current quarter (UTC). Q1=Jan–Mar, Q2=Apr–Jun, Q3=Jul–Sep, Q4=Oct–Dec. */
function getCurrentQuarterBounds() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1–12
  const q = Math.floor((m - 1) / 3) + 1; // 1–4
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = q * 3;
  const firstDay = `${y}-${String(startMonth).padStart(2, '0')}-01`;
  const lastDayNum = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  const lastDay = `${y}-${String(endMonth).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;
  return { firstDay, lastDay };
}

/**
 * Run all hygiene checks for one org.
 * @param {string} orgAlias - Target org alias
 * @param {{ minCurrentMonth: number, minUpcomingDays: number, minCount: number }} thresholds
 * @param {{ demoOwnerId?: string }} [org] - Optional org config; when demoOwnerId is set, all opp queries scope to this owner (demo POV).
 * @returns {Promise<import('./evaluator.js').CheckResult>}
 */
export async function runHygieneChecks(orgAlias, thresholds, org = {}) {
  const month = getCurrentMonthBounds();
  if (process.env.DEBUG_HYGIENE) {
    console.error(`[debug] Current month (UTC): ${month.firstDay} to ${month.lastDay}`);
  }
  const omegaPattern = (thresholds?.opportunities?.omegaAccountPattern ?? '%Omega%').replace(/'/g, "''");
  const quarter = getCurrentQuarterBounds();
  const ownerFilter = org?.demoOwnerId ? ` AND OwnerId = '${org.demoOwnerId}'` : '';
  // Use explicit UTC month/quarter so checks match Apex remediation (which uses dateGmt).
  // SOQL date filter values must be unquoted (e.g. 2026-03-01).
  const monthFilter = ` AND CloseDate >= ${month.firstDay} AND CloseDate <= ${month.lastDay}`;
  const quarterFilter = ` AND CloseDate >= ${quarter.firstDay} AND CloseDate <= ${quarter.lastDay}`;
  const results = {
    orgAlias,
    _monthBounds: { firstDay: month.firstDay, lastDay: month.lastDay },
    _quarterBounds: quarter,
    opportunitiesCurrentMonth: null,
    opportunitiesOmegaCurrentMonth: null,
    omegaFlagshipOpen: null,
    eventsUpcoming: null,
    activityOmegaOk: null,
    openCurrentQuarterTotal: null,
    openCurrentQuarterWithActivity: null,
    agentActivityReady: null,
    errors: [],
  };

  // Explicit month/quarter (UTC) so checks match Apex remediation and avoid org-timezone mismatches.
  const oppQuery = `SELECT COUNT() FROM Opportunity WHERE IsClosed = false${monthFilter}${ownerFilter}`;
  const oppResult = runSoql(orgAlias, oppQuery);
  if (oppResult.error) {
    results.errors.push(`Opportunities: ${oppResult.error}`);
  } else {
    const count = oppResult.totalSize ?? oppResult.records?.[0]?.expr0 ?? oppResult.records?.[0]?.count ?? 0;
    results.opportunitiesCurrentMonth = Number(count);
  }

  const omegaQuery = `SELECT COUNT() FROM Opportunity WHERE (Account.Name LIKE '${omegaPattern}' OR Name LIKE '${omegaPattern}') AND IsClosed = false${monthFilter}${ownerFilter}`;
  const omegaResult = runSoql(orgAlias, omegaQuery);
  if (omegaResult.error) {
    results.errors.push(`Omega opps: ${omegaResult.error}`);
  } else {
    const count = omegaResult.totalSize ?? omegaResult.records?.[0]?.expr0 ?? omegaResult.records?.[0]?.count ?? 0;
    results.opportunitiesOmegaCurrentMonth = Number(count);
  }

  const flagshipQuery = `SELECT COUNT() FROM Opportunity WHERE Name LIKE '%Omega%New Business%' AND IsClosed = false${monthFilter}${ownerFilter}`;
  const flagshipResult = runSoql(orgAlias, flagshipQuery);
  if (!flagshipResult.error) {
    const n = flagshipResult.totalSize ?? flagshipResult.records?.[0]?.expr0 ?? flagshipResult.records?.[0]?.count ?? 0;
    results.omegaFlagshipOpen = Number(n) >= 1;
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

  // Activity: use parent-child query (Task not supported in semi-join). LAST_N_DAYS:n = created in last n days.
  const activityDays = thresholds?.activity?.minRecentDays ?? 30;
  const activityQueryOmega = `SELECT Id, (SELECT Id FROM Tasks WHERE CreatedDate = LAST_N_DAYS:${activityDays}) FROM Opportunity WHERE (Account.Name LIKE '${omegaPattern}' OR Name LIKE '${omegaPattern}') AND IsClosed = false${monthFilter}${ownerFilter}`;
  const activityResultOmega = runSoql(orgAlias, activityQueryOmega);
  if (activityResultOmega.error) {
    results.errors.push(`Activity (Omega): ${activityResultOmega.error}`);
  } else if (results.opportunitiesOmegaCurrentMonth !== null) {
    const hasTasks = (r) => {
      const sub = r.Tasks ?? r.tasks;
      return (sub?.totalSize ?? sub?.records?.length ?? 0) > 0;
    };
    const withActivity = (activityResultOmega.records ?? []).filter(hasTasks).length;
    // Note: === 0 would be vacuously true (no Omega opps → activity trivially "ok"),
    // masking a missing-pipeline problem. Require opps to exist AND all have activity.
    results.activityOmegaOk = results.opportunitiesOmegaCurrentMonth > 0 && withActivity >= results.opportunitiesOmegaCurrentMonth;
  }

  // Agent Activity readiness: all open opps in current quarter (parent-child query for Tasks)
  const quarterTotalQuery = `SELECT COUNT() FROM Opportunity WHERE IsClosed = false${quarterFilter}${ownerFilter}`;
  const quarterTotalResult = runSoql(orgAlias, quarterTotalQuery);
  if (quarterTotalResult.error) {
    results.errors.push(`Quarter total: ${quarterTotalResult.error}`);
  } else {
    results.openCurrentQuarterTotal = Number(quarterTotalResult.totalSize ?? quarterTotalResult.records?.[0]?.expr0 ?? quarterTotalResult.records?.[0]?.count ?? 0);
  }
  const quarterWithActivityQuery = `SELECT Id, (SELECT Id FROM Tasks WHERE CreatedDate = LAST_N_DAYS:${activityDays}) FROM Opportunity WHERE IsClosed = false${quarterFilter}${ownerFilter}`;
  const quarterWithActivityResult = runSoql(orgAlias, quarterWithActivityQuery);
  if (quarterWithActivityResult.error) {
    results.errors.push(`Quarter with activity: ${quarterWithActivityResult.error}`);
  } else if (results.openCurrentQuarterTotal !== null) {
    const hasTasks = (r) => {
      const sub = r.Tasks ?? r.tasks;
      return (sub?.totalSize ?? sub?.records?.length ?? 0) > 0;
    };
    const withActivity = (quarterWithActivityResult.records ?? []).filter(hasTasks).length;
    results.openCurrentQuarterWithActivity = withActivity;
    // Note: === 0 would be vacuously true (empty pipeline → activity trivially "ready"),
    // causing the scheduler to skip EnsureOppActivity/Notes after EnsureCurrentMonthOpportunities
    // restores opps. Require opps to exist AND all have activity before marking ready.
    results.agentActivityReady =
      results.openCurrentQuarterTotal > 0 && withActivity >= results.openCurrentQuarterTotal;
  }

  return results;
}

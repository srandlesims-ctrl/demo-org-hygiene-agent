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
  const omegaPattern = (thresholds?.opportunities?.omegaAccountPattern ?? '%Omega%').replace(/'/g, "''");
  const results = {
    orgAlias,
    opportunitiesCurrentMonth: null,
    opportunitiesOmegaCurrentMonth: null,
    omegaFlagshipOpen: null,
    eventsUpcoming: null,
    activityOmegaOk: null,
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

  // Omega opportunities (open, current month) — agent FAILS if below threshold even if total passes
  const omegaQuery = `SELECT COUNT() FROM Opportunity WHERE Account.Name LIKE '${omegaPattern}' AND CloseDate >= ${month.firstDay} AND CloseDate <= ${month.lastDay} AND IsClosed = false`;
  const omegaResult = runSoql(orgAlias, omegaQuery);
  if (omegaResult.error) {
    results.errors.push(`Omega opps: ${omegaResult.error}`);
  } else {
    const row = omegaResult.records?.[0];
    const count = omegaResult.totalSize ?? row?.expr0 ?? row?.count ?? 0;
    results.opportunitiesOmegaCurrentMonth = Number(count);
  }

  // Omega flagship (e.g. "Omega, Inc. - New Business - 128K") open in current month
  const flagshipQuery = `SELECT COUNT() FROM Opportunity WHERE Name LIKE '%Omega%New Business%' AND CloseDate >= ${month.firstDay} AND CloseDate <= ${month.lastDay} AND IsClosed = false`;
  const flagshipResult = runSoql(orgAlias, flagshipQuery);
  if (!flagshipResult.error) {
    const row = flagshipResult.records?.[0];
    const n = flagshipResult.totalSize ?? row?.expr0 ?? row?.count ?? 0;
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

  // Activity: open Omega opps should have at least one Task in last 30 days
  const activityDays = thresholds?.activity?.minRecentDays ?? 30;
  const activityCutoff = new Date();
  activityCutoff.setUTCDate(activityCutoff.getUTCDate() - activityDays);
  const activityCutoffStr = activityCutoff.toISOString().slice(0, 10);
  const activityQuery = `SELECT COUNT() FROM Opportunity WHERE Account.Name LIKE '${omegaPattern}' AND CloseDate >= ${month.firstDay} AND CloseDate <= ${month.lastDay} AND IsClosed = false AND Id IN (SELECT WhatId FROM Task WHERE CreatedDate >= ${activityCutoffStr})`;
  const activityResult = runSoql(orgAlias, activityQuery);
  if (!activityResult.error && results.opportunitiesOmegaCurrentMonth !== null) {
    const row = activityResult.records?.[0];
    const withActivity = Number(activityResult.totalSize ?? row?.expr0 ?? row?.count ?? 0);
    results.activityOmegaOk = results.opportunitiesOmegaCurrentMonth === 0 || withActivity >= results.opportunitiesOmegaCurrentMonth;
  }

  return results;
}

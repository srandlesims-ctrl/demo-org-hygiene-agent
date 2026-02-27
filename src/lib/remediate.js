/**
 * Auto-remediation: create/update demo data when checks fail.
 * Runs Apex scripts via Salesforce CLI to add current-month opportunities and upcoming events.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run an Apex file against an org.
 * @param {string} orgAlias
 * @param {string} scriptPath - Path to .apex file (relative to project root or absolute)
 * @returns {{ ok: boolean, error?: string }}
 */
export function runApexScript(orgAlias, scriptPath) {
  try {
    const absolutePath = scriptPath.startsWith('/') ? scriptPath : join(__dirname, '..', '..', scriptPath);
    execSync(`sf apex run --file "${absolutePath}" --target-org ${orgAlias}`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
      timeout: 120000,
    });
    return { ok: true };
  } catch (e) {
    const msg = e.stderr?.toString() || e.stdout?.toString() || e.message;
    return { ok: false, error: msg.trim().slice(0, 500) };
  }
}

/**
 * Remediate an org: ensure current-month opportunities and upcoming events.
 * Uses inline Apex executed via sf apex run (single statement).
 * @param {string} orgAlias
 * @param {Object} evalResult - From evaluator.evaluate (has details about what's missing)
 * @returns {{ opportunitiesCreated?: number, eventsCreated?: number, errors: string[] }}
 */
export async function remediate(orgAlias, evalResult) {
  const errors = [];
  let opportunitiesCreated = 0;
  let eventsCreated = 0;

  // If opportunities are below threshold, run remediation script
  const scriptDir = join(__dirname, '..', '..', 'scripts');
  const oppScript = join(scriptDir, 'EnsureCurrentMonthOpportunities.apex');
  const eventScript = join(scriptDir, 'EnsureUpcomingEvents.apex');

  try {
    if (evalResult.details?.opportunitiesCurrentMonth !== null && evalResult.details.opportunitiesCurrentMonth < (evalResult._thresholds?.opportunities?.minCurrentMonth ?? 3)) {
      const res = runApexScript(orgAlias, oppScript);
      if (res.ok) opportunitiesCreated = 1; // script creates a batch
      else errors.push(`Opportunities: ${res.error}`);
    }
  } catch (e) {
    errors.push(`Opportunities remediation: ${e.message}`);
  }

  try {
    if (evalResult.details?.eventsUpcoming !== null && evalResult.details.eventsUpcoming < (evalResult._thresholds?.events?.minCount ?? 5)) {
      const res = runApexScript(orgAlias, eventScript);
      if (res.ok) eventsCreated = 1;
      else errors.push(`Events: ${res.error}`);
    }
  } catch (e) {
    errors.push(`Events remediation: ${e.message}`);
  }

  return { opportunitiesCreated, eventsCreated, errors };
}

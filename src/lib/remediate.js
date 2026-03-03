/**
 * Auto-remediation: create/update demo data when checks fail.
 * Runs Apex scripts via Salesforce CLI to add current-month opportunities and upcoming events.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
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
 * Remediate an org: opportunities (Omega-first move), events, and activity on Omega opps.
 * @param {string} orgAlias
 * @param {Object} evalResult - From evaluator.evaluate (has details about what's missing)
 * @returns {{ opportunitiesCreated?: number, eventsCreated?: number, activityCreated?: number, errors: string[] }}
 */
export async function remediate(orgAlias, evalResult) {
  const errors = [];
  let opportunitiesCreated = 0;
  let eventsCreated = 0;
  let activityCreated = 0;
  let notesCreated = 0;
  let flowStarted = 0;

  const scriptDir = join(__dirname, '..', '..', 'scripts');
  const oppScript = join(scriptDir, 'EnsureCurrentMonthOpportunities.apex');
  const eventScript = join(scriptDir, 'EnsureUpcomingEvents.apex');
  const activityScript = join(scriptDir, 'EnsureOppActivity.apex');
  const notesScript = join(scriptDir, 'EnsureOppNotes.apex');
  const flowScript = join(scriptDir, 'RunPipelineManagementFlow.apex');

  const minOpps = evalResult._thresholds?.opportunities?.minCurrentMonth ?? 3;
  const minOmega = evalResult._thresholds?.opportunities?.minOmega ?? 2;
  const needOppRemediation =
    (evalResult.details?.opportunitiesCurrentMonth != null && evalResult.details.opportunitiesCurrentMonth < minOpps) ||
    (evalResult.details?.opportunitiesOmegaCurrentMonth != null && evalResult.details.opportunitiesOmegaCurrentMonth < minOmega);

  try {
    if (needOppRemediation) {
      const res = runApexScript(orgAlias, oppScript);
      if (res.ok) opportunitiesCreated = 1;
      else errors.push(`Opportunities: ${res.error}`);
      if (process.env.DEBUG_HYGIENE && !res.ok && res.error) {
        console.error('[debug] Opportunities remediation error:', res.error);
      }
    }
  } catch (e) {
    errors.push(`Opportunities remediation: ${e.message}`);
  }

  try {
    if (evalResult.details?.eventsUpcoming != null && evalResult.details.eventsUpcoming < (evalResult._thresholds?.events?.minCount ?? 5)) {
      const res = runApexScript(orgAlias, eventScript);
      if (res.ok) eventsCreated = 1;
      else errors.push(`Events: ${res.error}`);
    }
  } catch (e) {
    errors.push(`Events remediation: ${e.message}`);
  }

  const needActivityRemediation =
    evalResult.details?.activityOmegaOk === false || evalResult.details?.agentActivityReady === false;
  const needNotesRemediation =
    evalResult.details?.activityOmegaOk === false || evalResult.details?.agentActivityReady === false;
  try {
    if (needActivityRemediation && existsSync(activityScript)) {
      const res = runApexScript(orgAlias, activityScript);
      if (res.ok) activityCreated = 1;
      else errors.push(`Activity: ${res.error}`);
    }
  } catch (e) {
    errors.push(`Activity remediation: ${e.message}`);
  }

  try {
    if (needNotesRemediation && existsSync(notesScript)) {
      const res = runApexScript(orgAlias, notesScript);
      if (res.ok) notesCreated = 1;
      else errors.push(`Notes: ${res.error}`);
    }
  } catch (e) {
    errors.push(`Notes remediation: ${e.message}`);
  }

  // Always run Pipeline Management flow when script exists so Agent Activity is refreshed on every npm start.
  // Flow handles empty current-quarter opps gracefully (debug and return).
  try {
    if (existsSync(flowScript)) {
      const res = runApexScript(orgAlias, flowScript);
      if (res.ok) flowStarted = 1;
      else errors.push(`Pipeline Management flow: ${res.error}`);
    }
  } catch (e) {
    errors.push(`Pipeline Management flow: ${e.message}`);
  }

  return { opportunitiesCreated, eventsCreated, activityCreated, notesCreated, flowStarted, errors };
}

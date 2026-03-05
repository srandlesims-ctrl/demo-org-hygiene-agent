#!/usr/bin/env node
/**
 * Demo Org Hygiene Agent
 * Runs hygiene checks across configured SDO orgs, evaluates pass/fail, reports to console + Slack, optionally remediates.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { checkOrgAuth } from './lib/auth.js';
import { runHygieneChecks } from './lib/checks.js';
import { evaluate } from './lib/evaluator.js';
import { reportConsole, reportSlack } from './lib/reporter.js';
import { remediate } from './lib/remediate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: join(__dirname, '..', '.env') });

function loadJson(path) {
  const full = path.startsWith('/') ? path : join(__dirname, '..', path);
  return JSON.parse(readFileSync(full, 'utf-8'));
}

async function main() {
  const args = process.argv.slice(2);
  const noRemediate = args.includes('--no-remediate');
  const doRemediate = args.includes('--remediate') || !noRemediate;

  const configPath = process.env.ORG_CONFIG_PATH || 'src/config/orgs.json';
  const thresholdsPath = process.env.THRESHOLDS_PATH || 'src/config/thresholds.json';

  let orgConfig, thresholds;
  try {
    orgConfig = loadJson(configPath).orgs;
    thresholds = loadJson(thresholdsPath);
  } catch (e) {
    console.error('Config load failed:', e.message);
    process.exit(1);
  }

  const results = [];
  const remResults = []; // Remediation result per org (null if not run)

  for (const org of orgConfig) {
    const alias = org.alias;
    const auth = await checkOrgAuth(alias);
    if (!auth.ok) {
      results.push({
        orgAlias: alias,
        pass: false,
        failures: [`Auth failed: ${auth.error}`],
        details: {},
      });
      remResults.push(null);
      continue;
    }

    const checkResult = await runHygieneChecks(alias, thresholds, org);
    const evalResult = evaluate(checkResult, thresholds);
    evalResult._thresholds = thresholds;
    results.push(evalResult);

    let rem = null;
    if (doRemediate && !evalResult.pass) {
      rem = await remediate(alias, evalResult);
      if (rem.errors.length) {
        evalResult.failures.push(`Remediation: ${rem.errors.join('; ')}`);
      } else if (rem.opportunitiesCreated || rem.eventsCreated || rem.activityCreated || rem.notesCreated || rem.flowStarted) {
        evalResult.failures.push('Remediation ran; re-run check to verify.');
      }
    }
    remResults.push(rem);
  }

  const orgList = orgConfig;
  reportConsole(results, orgList);

  const webhook = process.env.SLACK_WEBHOOK_URL;
  const runType = noRemediate ? 'check-only' : 'auto-remediate';

  if (webhook) {
    const slackResult = await reportSlack(results, webhook, orgList, remResults, runType);
    if (!slackResult.ok) {
      console.error('Slack report failed:', slackResult.error);
    } else {
      console.log('✓ Slack report sent.');
    }
  }

  const anyFailed = results.some((r) => !r.pass);
  process.exit(anyFailed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

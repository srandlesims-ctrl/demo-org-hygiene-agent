/**
 * Reporter: console output and Slack webhook.
 */

import https from 'https';

/**
 * Format a single org result for console.
 * @param {import('./evaluator.js').EvalResult} evalResult
 * @param {string} [region]
 */
export function formatOrgConsole(evalResult, region = '') {
  const status = evalResult.pass ? 'PASS' : 'FAIL';
  const regionStr = region ? ` [${region}]` : '';
  let out = `${evalResult.orgAlias}${regionStr}: ${status}`;
  if (!evalResult.pass && evalResult.failures.length) {
    out += `\n  - ${evalResult.failures.join('\n  - ')}`;
  }
  if (evalResult.details) {
    if (evalResult.details._monthBounds) {
      out += `\n  CloseDate range: ${evalResult.details._monthBounds.firstDay} to ${evalResult.details._monthBounds.lastDay}`;
    }
    out += `\n  Pipeline (current month): ${evalResult.details.opportunitiesCurrentMonth ?? 'N/A'}`;
    out += `\n  Omega opps: ${evalResult.details.opportunitiesOmegaCurrentMonth ?? 'N/A'}`;
    out += `\n  Events (upcoming): ${evalResult.details.eventsUpcoming ?? 'N/A'}`;
    out += `\n  Activity (Omega): ${evalResult.details.activityOmegaOk === true ? 'pass' : evalResult.details.activityOmegaOk === false ? 'fail' : 'N/A'}`;
    const total = evalResult.details.openCurrentQuarterTotal;
    const withAct = evalResult.details.openCurrentQuarterWithActivity;
    if (total != null && withAct != null) {
      out += `\n  Current quarter (agent-ready): ${withAct}/${total} opps with recent activity`;
    }
  }
  return out;
}

/**
 * Print full run summary to console.
 * @param {import('./evaluator.js').EvalResult[]} results
 * @param {{ alias: string, region: string }[]} orgConfig
 */
export function reportConsole(results, orgConfig) {
  const regionByAlias = Object.fromEntries(orgConfig.map((o) => [o.alias, o.region]));
  console.log('\n--- Demo Org Hygiene Report ---\n');
  results.forEach((r) => {
    console.log(formatOrgConsole(r, regionByAlias[r.orgAlias]));
    console.log('');
  });
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`Summary: ${passed} passed, ${failed} failed\n`);
}

/**
 * Build a rich Slack Block Kit payload for a hygiene run.
 * @param {import('./evaluator.js').EvalResult[]} results
 * @param {{ alias: string, region: string }[]} orgConfig
 * @param {Array<object|null>} remResults - Remediation result per org (null if skipped)
 * @param {'auto-remediate'|'check-only'} runType
 * @returns {object[]} Slack blocks array
 */
function buildSlackBlocks(results, orgConfig, remResults = [], runType = 'auto-remediate') {
  const regionByAlias = Object.fromEntries(orgConfig.map((o) => [o.alias, o.region]));
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const allPass = failed === 0;

  // Header
  const headerEmoji = allPass ? '✅' : '⚠️';
  const headerText = allPass
    ? `${headerEmoji} Demo Org — All Clear`
    : `${headerEmoji} Demo Org — Issues Found`;

  // Timestamp + run mode context
  const now = new Date();
  const dateStr = now.toUTCString().replace(/ GMT$/, ' UTC');
  const modeLabel = runType === 'check-only' ? 'Check only' : 'Auto-remediate';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: headerText, emoji: true },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `:calendar: ${dateStr}  ·  _${modeLabel}_` },
      ],
    },
    { type: 'divider' },
  ];

  // Per-org section
  results.forEach((r, i) => {
    const region = regionByAlias[r.orgAlias] || '';
    const statusEmoji = r.pass ? ':large_green_circle:' : ':red_circle:';
    const statusText = r.pass ? 'Pass' : 'Fail';

    const pipeline = r.details?.opportunitiesCurrentMonth ?? 'N/A';
    const omega = r.details?.opportunitiesOmegaCurrentMonth ?? 'N/A';
    const events = r.details?.eventsUpcoming ?? 'N/A';
    const total = r.details?.openCurrentQuarterTotal;
    const withAct = r.details?.openCurrentQuarterWithActivity;
    const agentReady = total != null && withAct != null ? `${withAct}/${total}` : 'N/A';
    const activityOk =
      r.details?.activityOmegaOk === true ? ':white_check_mark:' :
      r.details?.activityOmegaOk === false ? ':x:' : '—';

    // Org + status header row
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${statusEmoji} *${r.orgAlias}${region ? ` (${region})` : ''}* — ${statusText}`,
      },
    });

    // Metrics grid (2-column fields)
    blocks.push({
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Pipeline (month)*\n${pipeline} opps` },
        { type: 'mrkdwn', text: `*Omega opps*\n${omega}` },
        { type: 'mrkdwn', text: `*Upcoming events*\n${events}` },
        { type: 'mrkdwn', text: `*Omega activity*\n${activityOk}` },
        { type: 'mrkdwn', text: `*Agent-ready (qtr)*\n${agentReady} opps` },
      ],
    });

    // Failures list (if any)
    if (!r.pass && r.failures.length) {
      // Filter out the "Remediation ran" message — shown separately below
      const realFailures = r.failures.filter((f) => !f.startsWith('Remediation ran'));
      if (realFailures.length) {
        const failText = realFailures.map((f) => `• ${f}`).join('\n');
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: `:x: *What failed:*\n${failText}` },
        });
      }
    }

    // Remediation summary
    const rem = remResults[i];
    if (rem) {
      if (rem.errors.length) {
        const errText = rem.errors.map((e) => `• ${e}`).join('\n');
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:warning: *Remediation errors — check org manually:*\n${errText}`,
          },
        });
      } else {
        const fixed = [];
        if (rem.opportunitiesCreated) fixed.push('Moved opps to current month');
        if (rem.eventsCreated)        fixed.push('Added upcoming events');
        if (rem.activityCreated)      fixed.push('Added activity to Omega opps');
        if (rem.notesCreated)         fixed.push('Added notes to opps');
        if (rem.flowStarted)          fixed.push('Refreshed Pipeline Management flow');

        if (fixed.length) {
          const fixText = fixed.map((f) => `• ${f}`).join('\n');
          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:wrench: *Auto-fixed:*\n${fixText}\n\n_Re-run \`npm start\` to verify._`,
            },
          });
        }
      }
    }

    // Divider between orgs (not after last)
    if (i < results.length - 1) blocks.push({ type: 'divider' });
  });

  // Footer
  blocks.push({ type: 'divider' });
  if (allPass) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':sparkles: *Org is demo-ready. No fixes needed.*',
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ':robot_face: Hygiene agent ran remediation. Check Pipeline Inspection in ~5 min for fresh Agent Activity badges.',
      },
    });
  }

  return blocks;
}

/**
 * Send a rich hygiene report to Slack via incoming webhook.
 * Works with any webhook target — channel, private group, or DM.
 * To receive DMs: create a webhook in your Slack app pointed at "Direct Messages > [Your Name]".
 *
 * @param {import('./evaluator.js').EvalResult[]} results
 * @param {string} webhookUrl - Slack incoming webhook URL
 * @param {{ alias: string, region: string }[]} orgConfig
 * @param {Array<object|null>} [remResults] - Remediation result per org (null if not run)
 * @param {'auto-remediate'|'check-only'} [runType]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function reportSlack(results, webhookUrl, orgConfig, remResults = [], runType = 'auto-remediate') {
  if (!webhookUrl || !webhookUrl.startsWith('https://')) {
    return Promise.resolve({ ok: false, error: 'Missing or invalid SLACK_WEBHOOK_URL' });
  }

  const blocks = buildSlackBlocks(results, orgConfig, remResults, runType);
  const body = JSON.stringify({ blocks });

  return new Promise((resolve) => {
    const u = new URL(webhookUrl);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true });
        else resolve({ ok: false, error: `Slack returned ${res.statusCode}` });
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout' });
    });
    req.write(body);
    req.end();
  });
}

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
 * Send summary to Slack via incoming webhook.
 * @param {import('./evaluator.js').EvalResult[]} results
 * @param {string} webhookUrl - Slack incoming webhook URL
 * @param {{ alias: string, region: string }[]} orgConfig
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export function reportSlack(results, webhookUrl, orgConfig) {
  if (!webhookUrl || !webhookUrl.startsWith('https://')) {
    return Promise.resolve({ ok: false, error: 'Missing or invalid SLACK_WEBHOOK_URL' });
  }

  const regionByAlias = Object.fromEntries(orgConfig.map((o) => [o.alias, o.region]));
  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  const emoji = failed === 0 ? ':white_check_mark:' : ':warning:';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} Demo Org Hygiene Report`, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Summary:* ${passed} passed, ${failed} failed` },
    },
    { type: 'divider' },
  ];

  results.forEach((r) => {
    const region = regionByAlias[r.orgAlias] || '';
    const status = r.pass ? ':heavy_check_mark:' : ':x:';
    let text = `${status} *${r.orgAlias}* ${region}\n`;
    if (!r.pass && r.failures.length) {
      text += r.failures.map((f) => `  • ${f}`).join('\n');
    } else {
      const aq =
        r.details?.openCurrentQuarterWithActivity != null && r.details?.openCurrentQuarterTotal != null
          ? `${r.details.openCurrentQuarterWithActivity}/${r.details.openCurrentQuarterTotal} qtr`
          : 'N/A';
      text += `  Pipeline: ${r.details?.opportunitiesCurrentMonth ?? 'N/A'} | Omega: ${r.details?.opportunitiesOmegaCurrentMonth ?? 'N/A'} | Events: ${r.details?.eventsUpcoming ?? 'N/A'} | Activity: ${r.details?.activityOmegaOk === true ? 'pass' : r.details?.activityOmegaOk === false ? 'fail' : 'N/A'} | Agent-ready: ${aq}`;
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text } });
  });

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

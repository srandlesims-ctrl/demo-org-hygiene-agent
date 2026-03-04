#!/usr/bin/env node
/**
 * Interactive setup for demo-org-hygiene-agent.
 * Configures org alias, demo POV User ID, and optional Slack webhook.
 *
 * Usage: npm run setup
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const APEX_SCRIPTS = [
  'DemoSetup_StalePipeline.apex',
  'EnsureCurrentMonthOpportunities.apex',
  'EnsureOppActivity.apex',
  'EnsureOppNotes.apex',
  'RunPipelineManagementFlow.apex',
];

const DEFAULT_ALIAS   = 'sdo-amer';
const DEFAULT_USER_ID = '005Wt000004WHt3IAG';

function success(msg) { console.log(`\x1b[32m✅ ${msg}\x1b[0m`); }
function info(msg)    { console.log(`\x1b[36mℹ  ${msg}\x1b[0m`); }
function warn(msg)    { console.log(`\x1b[33m⚠  ${msg}\x1b[0m`); }

function ask(rl, question) {
  return new Promise(resolve => {
    if (rl.closed) return resolve('');
    rl.question(question, answer => resolve((answer || '').trim()));
    rl.once('close', () => resolve(''));
  });
}

async function fetchOrgUsers(alias) {
  try {
    const { stdout } = await execAsync(
      `sf data query --query "SELECT Id, Name, Username FROM User WHERE IsActive = true ORDER BY Name LIMIT 20" --target-org ${alias} --json`
    );
    const parsed = JSON.parse(stdout);
    return parsed?.result?.records || [];
  } catch {
    return null;
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n\x1b[1m🤖 Demo Org Hygiene Agent — Setup\x1b[0m\n');
  console.log('This will configure the agent for your SDO org.\n');

  // ── 1. Org alias ────────────────────────────────────────────────────────────
  let alias = await ask(rl, `Salesforce org alias (default: ${DEFAULT_ALIAS}): `);
  if (!alias) alias = DEFAULT_ALIAS;

  // ── 2. Demo POV User ID ─────────────────────────────────────────────────────
  let userId = '';
  console.log('');
  info(`Looking up users in org "${alias}"...`);
  const users = await fetchOrgUsers(alias);

  if (users === null) {
    warn(`Could not connect to org "${alias}". Make sure you've run:\n   sf org login web --alias ${alias}\n`);
  } else if (users.length === 0) {
    warn('No active users found. Falling back to manual entry.\n');
  } else {
    console.log('\nActive users in org:');
    users.forEach((u, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${u.Name.padEnd(25)} ${u.Id}   ${u.Username}`);
    });

    const pick = await ask(rl, `\nEnter the number of your demo POV user, or paste a User ID directly: `);
    const num = parseInt(pick, 10);

    if (!isNaN(num) && num >= 1 && num <= users.length) {
      userId = users[num - 1].Id;
      info(`Selected: ${users[num - 1].Name} (${userId})`);
    } else if (/^005[A-Za-z0-9]{12,15}$/.test(pick)) {
      userId = pick;
      info(`Using User ID: ${userId}`);
    } else {
      warn('Invalid selection — falling back to manual entry.');
    }
  }

  // Manual fallback
  if (!userId) {
    console.log('\nFind your User ID: Setup → Users → click your demo POV user → copy the ID from the URL');
    userId = await ask(rl, `Demo POV User ID (default: ${DEFAULT_USER_ID}): `);
    if (!userId) userId = DEFAULT_USER_ID;
  }

  // ── 3. Slack webhook (optional) ─────────────────────────────────────────────
  const slack = await ask(rl, '\nSlack webhook URL (optional, press Enter to skip): ');

  rl.close();
  console.log('');

  // ── Write src/config/orgs.json ───────────────────────────────────────────────
  const orgsConfig = {
    orgs: [
      {
        alias,
        region: 'AMER',
        description: 'Demo org configured via setup',
        demoOwnerId: userId,
      },
    ],
    _comment:
      'demoOwnerId = User Id for demo POV. All pipeline/activity checks and remediation scope to this owner. Run npm run setup to reconfigure.',
  };

  fs.writeFileSync(
    path.join(ROOT, 'src/config/orgs.json'),
    JSON.stringify(orgsConfig, null, 2) + '\n'
  );
  success('src/config/orgs.json updated');

  // ── Update User ID in Apex scripts ───────────────────────────────────────────
  let apexUpdated = 0;
  for (const file of APEX_SCRIPTS) {
    const filePath = path.join(ROOT, 'scripts', file);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    const replaced = content.replaceAll(DEFAULT_USER_ID, userId);

    if (replaced !== content) {
      fs.writeFileSync(filePath, replaced, 'utf8');
      apexUpdated++;
    } else if (!content.includes(userId)) {
      warn(`No User ID found to replace in ${file} — check it manually`);
    }
  }
  success(`Apex scripts updated (${apexUpdated} files)`);

  // ── Update org alias in package.json demo commands ───────────────────────────
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  let pkgChanged = false;

  for (const key of ['demo:before', 'demo:after', 'demo:flow', 'demo']) {
    if (pkg.scripts[key]?.includes(`--target-org ${DEFAULT_ALIAS}`)) {
      pkg.scripts[key] = pkg.scripts[key].replaceAll(`--target-org ${DEFAULT_ALIAS}`, `--target-org ${alias}`);
      pkgChanged = true;
    }
  }

  if (pkgChanged) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    success('package.json demo commands updated');
  }

  // ── Write .env ───────────────────────────────────────────────────────────────
  if (slack) {
    const envPath = path.join(ROOT, '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    if (envContent.includes('SLACK_WEBHOOK_URL=')) {
      envContent = envContent.replace(/SLACK_WEBHOOK_URL=.*/g, `SLACK_WEBHOOK_URL=${slack}`);
    } else {
      envContent += `\nSLACK_WEBHOOK_URL=${slack}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    success('.env updated with Slack webhook');
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  console.log('\n\x1b[1m✨ Setup complete!\x1b[0m\n');
  console.log(`  Org alias : ${alias}`);
  console.log(`  User ID   : ${userId}`);
  console.log(`  Slack     : ${slack || '(not configured)'}`);
  console.log('\nNext steps:');
  console.log('  npm start              — run the agent');
  console.log('  npm run demo:before    — stage the demo before state');
  console.log('  npm run demo:after     — restore the pipeline\n');
}

main().catch(err => {
  console.error('\n\x1b[31m❌ Setup failed:\x1b[0m', err.message);
  process.exit(1);
});

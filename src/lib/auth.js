/**
 * Auth manager: verify org is authorized and reachable (headless).
 * Uses Salesforce CLI (sf) - assumes orgs are already authorized (e.g. sf org login web --alias X).
 */

import { execSync } from 'child_process';

/**
 * Returns list of org aliases that are connected (from sf org list --json).
 * @returns {Promise<string[]>} aliases that are available
 */
export async function getAuthorizedOrgs() {
  try {
    const out = execSync('sf org list --json', { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    const data = JSON.parse(out);
    const aliases = (data.result?.nonScratchOrgs || [])
      .concat(data.result?.scratchOrgs || [])
      .map((o) => o.alias)
      .filter(Boolean);
    return [...new Set(aliases)];
  } catch (e) {
    return [];
  }
}

/**
 * Check if an org alias is authorized and connected.
 * @param {string} alias - Org alias
 * @returns {Promise<{ ok: boolean, username?: string, error?: string }>}
 */
export async function checkOrgAuth(alias) {
  try {
    const out = execSync(`sf org display --target-org ${alias} --json`, {
      encoding: 'utf-8',
      maxBuffer: 512 * 1024,
    });
    const data = JSON.parse(out);
    const username = data.result?.username ?? data.result?.alias;
    return { ok: true, username: username || alias };
  } catch (e) {
    const msg = e.stderr?.toString() || e.message || 'Unknown error';
    return { ok: false, error: msg.trim() };
  }
}

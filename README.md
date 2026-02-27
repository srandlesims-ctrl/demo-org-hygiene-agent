# Demo Org Hygiene Agent

A lightweight automated agent that monitors and maintains Salesforce demo org (SDO) environments used across **AMER**, **EMEA**, and **APAC** events. It runs on a schedule (e.g. every few days), checks each org for current, realistic demo data, flags issues, and optionally auto-remediates stale or missing data.

## Goals

- Ensure every SDO has **current-month Opportunity** and **calendar (Event)** data before events run
- Surface org health status via **Slack** and **console** report
- Auto-fix common hygiene issues (stale close dates, missing events) when enabled
- Support **multiple orgs** across regions without manual logins (after one-time auth)

## Architecture

| Component | Description |
|-----------|-------------|
| **Org config registry** | `src/config/orgs.json` – list of org aliases and regions |
| **Thresholds** | `src/config/thresholds.json` – min opportunities (current month), min events (upcoming days) |
| **Auth manager** | Uses Salesforce CLI (`sf`) – orgs must be pre-authorized |
| **Hygiene check engine** | SOQL: Opportunities (current month), Events (next N days) |
| **Evaluator** | Pass/fail vs thresholds |
| **Reporter** | Console + optional Slack webhook |
| **Auto-remediation** | Runs Apex scripts to create opportunities/events when below threshold |
| **Scheduler** | GitHub Actions cron (or local cron) |

## Prerequisites

- **Node.js** 18+
- **Salesforce CLI** (`sf`) installed and authenticated for each SDO
- (Optional) **Slack** incoming webhook URL for notifications

## Setup

### 1. Install dependencies

```bash
cd demo-org-hygiene-agent
npm install
```

### 2. Authorize your SDO orgs

For each demo org (AMER, EMEA, APAC):

```bash
sf org login web --alias sdo-amer --instance-url https://login.salesforce.com
# Repeat for sdo-emea, sdo-apac (or your aliases)
```

### 3. Configure org list and thresholds

- **`src/config/orgs.json`** – set `alias` to match your `sf org list` aliases and set `region` (AMER, EMEA, APAC).
- **`src/config/thresholds.json`** – adjust `minCurrentMonth` (opportunities) and `minCount` / `minUpcomingDays` (events) as needed.

### 4. (Optional) Slack

Copy `.env.example` to `.env` and set:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## Usage

```bash
# Run checks and auto-remediate when below threshold
npm start

# Run checks only (no remediation)
npm run check

# Same as npm start (explicit remediate)
npm run remediate
```

- **Exit code:** `0` if all orgs pass, `1` if any fail (for CI).

## Scheduling

### Scheduled runs in GitHub

1. **Create a GitHub repo** (if you don’t have one)  
   On GitHub: **Repositories → New** (or “Create repository”). Name it e.g. `demo-org-hygiene-agent`.

2. **Push this project**  
   From your machine, in the folder that contains the agent (either the `demo-org-hygiene-agent` folder alone or the whole “SDO Agentforce Sales” folder):
   ```bash
   git init
   git add .
   git commit -m "Add demo org hygiene agent"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/demo-org-hygiene-agent.git
   git push -u origin main
   ```
   - If the **repo root** is the `demo-org-hygiene-agent` folder, the workflow at `demo-org-hygiene-agent/.github/workflows/hygiene-check.yml` will run.
   - If the **repo root** is the parent (“SDO Agentforce Sales”), use the workflow at the root: `.github/workflows/demo-org-hygiene.yml` (see below) so the job runs with `working-directory: demo-org-hygiene-agent`.

3. **Add secret for Salesforce auth**  
   In the repo: **Settings → Secrets and variables → Actions → New repository secret**.
   - **Name:** `SF_AUTH_URL`
   - **Value:** An auth URL for your SDO org (e.g. sdo-amer). To get one:
     - Log in locally: `sf org login web --alias sdo-amer`
     - Then run: `sf org display --target-org sdo-amer --verbose` and look for the URL in the output, or use the **Auth URL** from the org’s connected session (Salesforce docs: “auth URL” or “sfdx auth url” for CI).
     - Alternatively create a **JWT** connected app and use `sf org login jwt` in the workflow; then you’d use secrets like `SF_CLIENT_ID`, `SF_JWT_KEY`, etc., instead of `SF_AUTH_URL`.
   Without this secret, the workflow runs but the hygiene check will fail with “Auth failed” for that org.

4. **Optional: Slack**  
   Add secret **`SLACK_WEBHOOK_URL`** (your Slack Incoming Webhook URL) so the run posts the report to Slack.

5. **Run and schedule**  
   - **Manual run:** **Actions → Demo Org Hygiene Check → Run workflow**.
   - **Automatic:** The workflow runs **every 3 days at 06:00 UTC**; no extra setup.

### GitHub Actions workflow summary

- **Workflow:** `.github/workflows/hygiene-check.yml` (when the repo is the agent folder) or `.github/workflows/demo-org-hygiene.yml` (when the repo is the parent folder).
- **Schedule:** Every 3 days at 06:00 UTC; also `workflow_dispatch` for manual runs.
- **Secrets:** `SF_AUTH_URL` (required for CI auth), `SLACK_WEBHOOK_URL` (optional).

### Local cron

```bash
# Every 3 days at 6 AM
0 6 */3 * * cd /path/to/demo-org-hygiene-agent && npm run check
```

## Auto-remediation

When an org is **below** the configured thresholds:

1. **Opportunities** – `scripts/EnsureCurrentMonthOpportunities.apex` creates open Opportunities with Close Date in the current month.
2. **Events** – `scripts/EnsureUpcomingEvents.apex` creates Events in the next 14 days for the running user.

Remediation runs only when you use `npm start` (or `npm run remediate`). Use `npm run check` in CI to avoid creating data automatically.

## Config reference

- **orgs.json** – `alias` (required), `region`, `description`
- **thresholds.json** – `opportunities.minCurrentMonth`, `events.minUpcomingDays`, `events.minCount`
- **.env** – `SLACK_WEBHOOK_URL`, optional `ORG_CONFIG_PATH`, `THRESHOLDS_PATH`

## License

MIT

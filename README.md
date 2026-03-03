# Demo Org Hygiene Agent

A lightweight automated agent that monitors and maintains Salesforce demo org (SDO) environments used for **events, demo booth, and customer deal cycles**. It runs on a schedule (every 3 days in GitHub Actions), checks each org for current, realistic demo data, flags issues, and auto-remediates so the org has everything it needs whenever someone uses it.

## Goals

- Ensure every SDO has **current-quarter pipeline** (open opps owned by the demo POV user, e.g. Jennifer Hynes), **upcoming calendar events**, and **recent activity** (Tasks + Enhanced Notes) on those opps
- Populate **Pipeline Management Agent Activity** for all current-quarter demo POV opps (Tasks, Notes, and flow run so Pipeline Inspection shows insights)
- Surface org health status via **Slack** and **console** report
- Auto-fix by **moving** existing opportunities into the current month (Omega-first), adding events, Tasks, Notes, and running the Pipeline Management flow — **no creating new opps**
- Support **multiple orgs** across regions without manual logins (after one-time auth)

## Architecture

| Component | Description |
|-----------|-------------|
| **Org config registry** | `src/config/orgs.json` – list of org aliases and regions |
| **Thresholds** | `src/config/thresholds.json` – opportunities (total + Omega), events, activity |
| **Auth manager** | Uses Salesforce CLI (`sf`) – orgs must be pre-authorized |
| **Hygiene check engine** | SOQL: pipeline count, Omega count, flagship opp, events, Omega activity |
| **Evaluator** | Pass/fail vs thresholds (fails if Omega is below threshold even when total passes) |
| **Reporter** | Console + optional Slack webhook (Pipeline, Omega, Events, Activity) |
| **Auto-remediation** | Apex: move/reopen opps (Omega-first), create events, add Tasks and Enhanced Notes on open current-quarter opps; then run Pipeline Management flow so Agent Activity is populated |
| **Scheduler** | GitHub Actions: every 3 days (check + remediate + Pipeline Management flow) |

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
- **`src/config/thresholds.json`** – `opportunities.minCurrentMonth`, `opportunities.minOmega`, `opportunities.omegaAccountPattern`, `events.minCount` / `minUpcomingDays`, `activity.minRecentDays`.

### 4. (Optional) Slack

Copy `.env.example` to `.env` and set:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

## Usage

```bash
# Run checks and auto-remediate when below threshold (always runs Pipeline Management flow)
npm start

# Run checks only (no remediation)
npm run check

# Same as npm start (explicit remediate)
npm run remediate

# Demo: create before state, then fix, then optionally refresh flow
npm run demo:before    # Move Jennifer's current-quarter opps to previous quarter (stale pipeline)
npm run demo:fix       # npm start twice (remediate then verify)
npm run demo:flow      # Run Pipeline Management flow only
npm run demo           # Full reset: demo:before + demo:fix + demo:flow
```

- **Exit code:** `0` if all orgs pass, `1` if any fail (for CI).

## Scheduling

### Scheduled runs in GitHub

The workflow runs **every 3 days** at 06:00 UTC: (1) `npm start` (check + remediate — opps, events, Tasks, Notes), (2) `RunPipelineManagementFlow.apex` so Agent Activity is refreshed for all current-quarter demo POV opps. The demo org stays ready for events, booth, and deal cycles.

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

1. **Opportunities** – `scripts/EnsureCurrentMonthOpportunities.apex` **moves** existing opportunities (does not create). Priority: (1) reactivate closed Omega opps (e.g. 128K) → stage `Negotiation`, (2) move stale open opps into current month — **previous-quarter** opps first (same set as demo script, including Omega 44k/128k), then other stale, (3) reopen closed non-Omega from last 120 days → stage `Qualification`.
2. **Events** – `scripts/EnsureUpcomingEvents.apex` creates Events in the next 14 days (Omega-themed subjects when possible).
3. **Activity** – `scripts/EnsureOppActivity.apex` adds completed Tasks on open current-quarter opps (demo POV owner) that have no activity in the last 30 days.
4. **Notes** – `scripts/EnsureOppNotes.apex` adds one Enhanced Note (Lightning Notes) per open current-quarter opp that doesn’t already have a recent note, so Pipeline Management has Notes + Tasks for insights.

Remediation runs only when you use `npm start` (or `npm run remediate`). Use `npm run check` in CI to avoid creating data automatically.

## Demo setup (before showing the agent)

To show the agent "fixing" the org, create a messy state first (run against your SDO alias, e.g. `sdo-amer`):

```bash
# Move Jennifer Hynes’s current-quarter open opps to previous quarter (stale pipeline)
sf apex run --file scripts/DemoSetup_StalePipeline.apex --target-org sdo-amer
```

Then run the agent: `npm start`. The agent will move those opps back to the current month with Tasks, Notes, and Agent Activity.

**Why the right opps come back:** Remediation (1) reactivates closed Omega opps first, then (2) moves **previous-quarter** stale open opps into the current month (the same set moved by `DemoSetup_StalePipeline`, including Omega 44k/128k and other strong demo opps), then (3) other stale or closed opps if still under threshold. Checks use the same UTC month/quarter as Apex so pass/fail matches what you see in Pipeline Inspection.

**How the before state works:** `DemoSetup_StalePipeline.apex` moves all of Jennifer’s current-quarter open opps to the previous quarter. They no longer appear when you filter Pipeline Inspection by **Close Date: This Quarter**. Omega 128K stays open — no manual delete needed.

**Note:** Jennifer Hynes’s User Id is hardcoded in `DemoSetup_StalePipeline.apex` (`005Wt000004WHt3IAG`). If your SDO uses a different Id, edit that script.

### Scheduler stress-test (separate from the demo)

`DemoSetup_CloseOmega128K.apex` simulates the real-world scenario where an SE or PMM accidentally closes the Omega 128K deal. This is **not** part of the before/after demo — it’s used to test that the **scheduled hygiene run** (every 3 days) correctly detects and reactivates a closed flagship opp. Run it on its own when you want to verify the auto-remediation path:

```bash
sf apex run --file scripts/DemoSetup_CloseOmega128K.apex --target-org sdo-amer
# Then either wait for the next scheduled run, or trigger manually:
npm start
```

### Live demo: commands to show in real time

Use the npm scripts below so the audience sees the **before** (empty pipeline) and **after** (full pipeline with Omega and Agent Activity). All commands assume you are in the project root (`demo-org-hygiene-agent`) and the org alias is `sdo-amer`.

**1. Create the before state**

```bash
npm run demo:before
```

Then in Salesforce, log in as **Jennifer Hynes** and open **Sales → Opportunities → My Pipeline** with **Close Date: This Quarter**, **Owner: Me**. Refresh. Show that the pipeline is **empty** (0 opps, Agent Activity None).

**2. Restore the pipeline — opps + activity + Pipeline Management flow in one command**

```bash
npm run demo:after
```

This runs `npm start` (remediates: moves opps back to current quarter, adds Tasks and Notes, then runs the Pipeline Management flow) followed immediately by an explicit second flow run for a fresh signal pass. Refresh **Pipeline Inspection** (same filters). Show that **This Quarter** now has 8+ opps including Omega (44k and 128k) with Tasks, Notes, and Agent Activity. Insights may take 2–5 minutes to appear — refresh once more after that.

**Full automated reset (one command, no steps)**

```bash
npm run demo
```

Runs `demo:before` → `demo:after` end to end. Use this when you want to reset the org silently before the audience is watching, then open Pipeline Inspection to show the result.
## Run Pipeline Management flow

The **Pipeline Management** flow (same as clicking "Get Pipeline Management Insights") runs **automatically** on every `npm start` (so Agent Activity is always refreshed when you run the agent), and again in the GitHub Actions scheduled job every 3 days. It targets **all open current-quarter opportunities** for the demo POV user (e.g. Jennifer Hynes), so Agent Activity is populated for the same opps that have Tasks and Notes.

To run it **manually** from the command line:

1. **Prerequisites (required for Agent Activity insights):**
   - **Einstein Activity Capture (EAC)** and **Einstein Conversation Insights (ECI)** must be enabled. Pipeline Management uses this data to generate insights; without them, the feature cannot work as designed.
   - Pipeline Management must be set up (Agentforce Pipeline Management on, agent created, permission set assigned, flow active). See the Pipeline Management SDO demo guide for setup.

2. **Data on opportunities:** The agent suggests next steps by analyzing **recent activity** on the opportunity (emails, calls, notes, tasks). The flow runs regardless, but **Agent Activity will stay "None"** for opps with no recent activity to analyze. The hygiene agent **checks and updates** this for you: it ensures every open opportunity in the **current quarter** (same scope as Pipeline Inspection "This Quarter") has at least one Task in the last 30 days. Run `npm start` or `npm run remediate` to add Tasks where missing; the check appears as "Current quarter (agent-ready): X/Y opps with recent activity" in the report.

3. **Run the flow** (no button click):
   ```bash
   sf apex run --file scripts/RunPipelineManagementFlow.apex --target-org sdo-amer
   ```

4. **Confirm the flow API name** if you get a compile error: In Setup go to **Flows**, open **SDO Process Field Updates Autolaunch**, and check the **API Name**. If it differs (e.g. a namespace prefix), update the class name in `scripts/RunPipelineManagementFlow.apex` to match (e.g. `Flow.Interview.YourActualApiName`).

5. **Check results**: Go to **Opportunities > Pipeline Inspection**, filter by Close Date (e.g. This Quarter). In the **Agent Activity** column, look for **Need Review** or **Update Next Step!**; open an item to see the insight and Accept / Edit / Decline. Insights can take a few minutes to appear after the flow runs. **If only one or two opps show Agent Activity:** Pipeline Management generates insights from recent activity (Tasks, Notes, emails, calls). Run `npm start` again so the hygiene agent adds Tasks and Notes to current-quarter opps that don’t have them, then runs the flow again; wait a few minutes and refresh Pipeline Inspection for more insights to appear.

## Config reference

- **orgs.json** – `alias` (required), `region`, `description`, `demoOwnerId` (optional) — when set, all pipeline and activity checks and remediation scope to opportunities owned by this User Id (demo POV, e.g. Jennifer Hynes). Apex scripts use the same Id; if your SDO uses a different user, set `demoOwnerId` in orgs.json and update the `demoOwnerId` constant in each script under `scripts/`.
- **thresholds.json** – `opportunities.minCurrentMonth`, `opportunities.minOmega`, `opportunities.omegaAccountPattern`, `opportunities.reopenStageOmega` / `reopenStageOther`, `events.minUpcomingDays`, `events.minCount`, `activity.minRecentDays`, `activity.omegaOnly`
- **.env** – `SLACK_WEBHOOK_URL`, optional `ORG_CONFIG_PATH`, `THRESHOLDS_PATH`

## License

MIT

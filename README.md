# Demo Org Hygiene Agent

An autonomous agent that keeps your Salesforce SDO ready to demo — no manual resets needed. It runs every 3 days via GitHub Actions, checks the org for stale data, and self-heals: moving opps back to the current quarter, adding activity, and triggering Pipeline Management insights.

> **The meta-story:** You built an agent to maintain the org you use to demo agents. 🤖

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/srandlesims-ctrl/demo-org-hygiene-agent
cd demo-org-hygiene-agent
npm install

# 2. Authenticate to your SDO
sf org login web --alias sdo-amer --instance-url https://login.salesforce.com

# 3. Configure for your org (picks your demo POV user, sets org alias)
npm run setup

# 4. Run the agent
npm start
```

`npm run setup` connects to your org, lists active users, and lets you pick your demo POV user — no manual file editing needed. Run it once and you're configured.

---

## Demo Commands

Use these when showing the agent live to a customer or team.

```bash
npm run demo:before   # Stage the "before" — moves Jennifer's opps to last quarter (empty pipeline)
npm run demo:after    # Restore everything — 10 opps, Tasks, Notes, Pipeline Management flow
npm run demo          # Both in one command (silent reset before the audience watches)
npm run demo:flow     # Re-run Pipeline Management flow only (quick refresh)
```

### Step-by-step demo flow

**1. Create the before state**
```bash
npm run demo:before
```
In Salesforce, log in as **Jennifer Hynes** → **Sales → Pipeline Inspection** → filter **Close Date: This Quarter, Owner: Me**. Show that the pipeline is **empty** ($0, Agent Activity: None).

**2. Restore the pipeline**
```bash
npm run demo:after
```
Refresh Pipeline Inspection. **This Quarter** now shows **10 opps** including Omega 128K with Tasks, Notes, and Agent Activity badges. Insights may take 2–5 minutes — refresh once more.

- **Omega 128K** (Negotiation, end-of-month close, no Next Step) → shows **"Update Next Step?"**

---

## How It Works

The agent runs an **observe → evaluate → act** loop:

| Step | What happens |
|------|-------------|
| **Observe** | SOQL queries check pipeline count, Omega opps, upcoming events, and activity |
| **Evaluate** | Results compared against thresholds — fails if any check is below minimum |
| **Act** | Apex scripts fix what's broken, then Pipeline Management flow runs |

### What gets fixed automatically (`npm start`)

1. **Opportunities** — moves stale opps back to current month (Omega-first, no new records created)
2. **Events** — creates upcoming calendar events if below threshold
3. **Activity** — adds Tasks to opps with no recent activity
4. **Notes** — adds Enhanced Notes to opps missing them
5. **Pipeline Management flow** — always runs so Agent Activity badges are fresh

---

## Setup

### Prerequisites

- **Node.js** 18+
- **Salesforce CLI** (`sf`) installed
- (Optional) Slack incoming webhook for notifications

### ⚠️ Important: Jennifer Hynes User ID

All Apex scripts are scoped to Jennifer Hynes (`005Wt000004WHt3IAG`) — the demo POV user for sdo-amer. If your SDO uses a different user:

1. Update `demoOwnerId` in `src/config/orgs.json`
2. Update the `demoOwnerId` constant at the top of each script in `scripts/`

### 1. Install dependencies

```bash
npm install
```

### 2. Authenticate your SDO org(s)

```bash
sf org login web --alias sdo-amer --instance-url https://login.salesforce.com
# Repeat for sdo-emea, sdo-apac if needed
```

### 3. (Optional) Slack health reports

Every run sends a rich Block Kit report to Slack — org metrics, what passed/failed, and exactly what was auto-fixed. Works as a DM or channel post.

**To get reports as a DM:**
1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch
2. **Incoming Webhooks** → Activate Incoming Webhooks
3. **Add New Webhook to Workspace** → choose **Direct Messages → [Your Name]**
4. Copy the webhook URL

Copy `.env.example` to `.env` and paste it in:

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

> **GitHub Actions:** Add `SLACK_WEBHOOK_URL` as a repo secret (Settings → Secrets and variables → Actions) and the scheduled run will DM you automatically.

---

## Autonomous Scheduling (GitHub Actions)

The repo already includes a workflow that runs every 3 days at 06:00 UTC. To enable it:

### 1. Fork or clone the repo to your own GitHub account

### 2. Get your Salesforce auth URL

```bash
sf org display --target-org sdo-amer --verbose --json | grep sfdxAuthUrl
```

Copy the value — it looks like `force://...`.

### 3. Add the secret to GitHub

In your repo: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|-------|
| `SF_AUTH_URL` | The auth URL from step 2 |
| `SLACK_WEBHOOK_URL` | (Optional) Your Slack webhook URL |

### 4. That's it

- **Manual trigger:** Actions → Demo Org Hygiene Check → Run workflow
- **Automatic:** Runs every 3 days at 06:00 UTC — no further setup needed

---

## All Commands

```bash
npm start             # Check + auto-remediate (recommended for scheduler)
npm run check         # Check only — no changes made
npm run remediate     # Same as npm start

npm run demo:before   # Stage broken state for demo
npm run demo:after    # Restore full pipeline + activity + flow
npm run demo:flow     # Run Pipeline Management flow only
npm run demo          # Full reset: demo:before → demo:after
```

Exit code `0` = all orgs pass, `1` = any org failed (CI-friendly).

---

## Thresholds

Thresholds live in `src/config/thresholds.json`. The agent triggers remediation when the org falls below these:

| Threshold | Value | Notes |
|-----------|-------|-------|
| `minCurrentMonth` | 8 | Apex restores to 10 as a buffer |
| `minOmega` | 2 | Minimum Omega opps in current quarter |
| `requireAllCurrentQuarterForAgent` | true | All opps need activity, not just Omega |

---

## Why Omega 128K Always Comes Back

`DemoSetup_StalePipeline.apex` sorts Omega opps by **Amount DESC** before assigning stale dates, so the highest-value Omega opp (~$128K) always gets the latest stale date (Dec 31). `EnsureCurrentMonthOpportunities` queries Omega opps `ORDER BY CloseDate DESC`, so 128K is always first in the restore queue — no matter how many other Omega opps exist.

---

## Pipeline Management Notes

- **EAC and ECI must be enabled** for Agent Activity insights to appear
- After `demo:after`, insights can take **2–5 minutes** to populate — refresh Pipeline Inspection once more
- If Agent Activity shows "None" after the flow runs, re-run `npm start` to ensure Tasks and Notes exist, then wait and refresh

**If you get a compile error on the flow:**
Go to **Setup → Flows → SDO Process Field Updates Autolaunch** and check the API Name. Update `scripts/RunPipelineManagementFlow.apex` if it differs.

---

## Stress Test (Scheduler Verification)

`DemoSetup_CloseOmega128K.apex` simulates an SE accidentally closing the Omega 128K deal. Use it to verify the autonomous scheduler catches and fixes it:

```bash
sf apex run --file scripts/DemoSetup_CloseOmega128K.apex --target-org sdo-amer
npm start   # or wait for the next scheduled run
```

This is separate from the before/after demo — it tests the scheduler path, not the demo flow.

---

## Config Reference

| File | Purpose |
|------|---------|
| `src/config/orgs.json` | Org aliases, regions, and `demoOwnerId` per org |
| `src/config/thresholds.json` | Pass/fail thresholds for opps, events, and activity |
| `.env` | `SLACK_WEBHOOK_URL`, optional path overrides |

---

## License

MIT

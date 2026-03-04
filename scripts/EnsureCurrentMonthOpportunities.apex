// Demo Org Hygiene Agent — Opportunity Remediation
// Moves existing opportunities into current month for demo POV owner. Prioritizes Omega.
// Searches ANY stale date before current month so it works regardless of how far back
// demo:before moved the opps (one quarter back, two quarters back, etc.)
// Run via: sf apex run --file scripts/EnsureCurrentMonthOpportunities.apex --target-org <alias>

Id demoOwnerId = '005Wt000004WHt3IAG';  // Jennifer Hynes — demo POV for SDO
Integer minTotal = 10;   // Opps to restore — buffer above the 8-opp scheduler trigger threshold
Integer minOmega = 2;    // Minimum Omega for pass check; Step 2a restores ALL Omega found (see below)
String omegaPattern = '%Omega%';
String reopenStageOmega = 'Negotiation';
String reopenStageOther = 'Discovery';

// Use UTC for "current month" so Apex matches the Node.js check (which uses UTC)
Date todayUtc = Datetime.now().dateGmt();
Date firstDayMonth = Date.newInstance(todayUtc.year(), todayUtc.month(), 1);
Date lastDayMonth = firstDayMonth.addMonths(1).addDays(-1);

// Assign restored close dates starting from TOMORROW to avoid the PM badge skip:
// PM won't badge opps that are overdue AND have Days in Stage = 0 (which happens right
// after the DML update triggers SDO_Tool_SalesforceRewind_Opportunity).
Date assignBase = todayUtc.addDays(1);
Integer assignWindow = (Integer)assignBase.daysBetween(lastDayMonth);
if (assignWindow < 1) assignWindow = 1;  // Edge case: last day of month

System.debug('=== EnsureCurrentMonthOpportunities ===');
System.debug('Current month: ' + firstDayMonth + ' → ' + lastDayMonth);
System.debug('Assign base: ' + assignBase + ' (restoring opps from tomorrow onward to avoid overdue+DIS=0)');

// --- Count current state (demo POV owner only) ---
List<Opportunity> currentOpps = [
    SELECT Id, Name, Account.Name FROM Opportunity
    WHERE OwnerId = :demoOwnerId
      AND CloseDate >= :firstDayMonth AND CloseDate <= :lastDayMonth AND IsClosed = false
];
Integer currentTotal = currentOpps.size();
Integer currentOmega = 0;
for (Opportunity o : currentOpps) {
    if ((o.Account != null && o.Account.Name != null && o.Account.Name.containsIgnoreCase('Omega'))
        || (o.Name != null && o.Name.containsIgnoreCase('Omega'))) {
        currentOmega++;
    }
}
System.debug('Current month: ' + currentTotal + ' open opps (' + currentOmega + ' Omega) — need ≥' + minTotal + ' total, ≥' + minOmega + ' Omega');

if (currentTotal >= minTotal && currentOmega >= minOmega) {
    System.debug('PASS — Thresholds met. No remediation needed.');
} else {
    System.debug('REMEDIATION needed (total=' + currentTotal + '/' + minTotal + ', Omega=' + currentOmega + '/' + minOmega + ')');
    Set<Id> seen = new Set<Id>();
    for (Opportunity o : currentOpps) seen.add(o.Id);
    List<Opportunity> toUpdate = new List<Opportunity>();
    Integer dayOffset = 0;
    List<Id> excludeIds;

    // STEP 1: Reactivate closed Omega opps (last resort — only if none found open)
    if (currentOmega < minOmega) {
        excludeIds = new List<Id>(seen);
        List<Opportunity> closedOmega = [
            SELECT Id, Name, StageName, CloseDate FROM Opportunity
            WHERE OwnerId = :demoOwnerId
              AND (Account.Name LIKE :omegaPattern OR Name LIKE :omegaPattern) AND IsClosed = true
              AND Id NOT IN :excludeIds
            ORDER BY CloseDate DESC LIMIT 5
        ];
        System.debug('Step 1 — Closed Omega candidates: ' + closedOmega.size());
        for (Opportunity o : closedOmega) {
            if (currentOmega >= minOmega && currentTotal >= minTotal) break;
            o.StageName = reopenStageOmega;
            o.CloseDate = lastDayMonth;  // End of month: never overdue, PM generates badge
            toUpdate.add(o);
            seen.add(o.Id);
            currentOmega++;
            currentTotal++;
            System.debug('  [step1] Reactivated: ' + o.Name + ' → Negotiation, ' + lastDayMonth);
        }
    }

    // STEP 2: Move stale open opps into current month.
    // Searches ANY date before current month — works regardless of which quarter demo:before
    // targeted. DemoSetup_StalePipeline assigns Omega opps the LATEST stale dates (sorted
    // by Amount DESC → 128K gets the latest) so ORDER BY CloseDate DESC always picks them first.

    // 2a: Omega opps — restored first, always get end-of-month close date (PM badge trigger)
    if (currentOmega < minOmega) {
        excludeIds = new List<Id>(seen);
        List<Opportunity> staleOmega = [
            SELECT Id, Name, StageName, CloseDate, Account.Name FROM Opportunity
            WHERE OwnerId = :demoOwnerId
              AND IsClosed = false AND CloseDate < :firstDayMonth
              AND (Account.Name LIKE :omegaPattern OR Name LIKE :omegaPattern)
              AND Id NOT IN :excludeIds
            ORDER BY CloseDate DESC LIMIT 5
        ];
        System.debug('Step 2a — Stale Omega opps found: ' + staleOmega.size());
        for (Opportunity o : staleOmega) {
            // Take ALL Omega opps up to total budget — do NOT break at minOmega=2.
            // This ensures every Omega opp (including 128K wherever it landed from demo:before)
            // gets moved back to current quarter so the NEXT demo:before can sort them all
            // correctly by Amount DESC, permanently fixing the rotation.
            if (currentTotal >= minTotal) break;
            o.CloseDate = lastDayMonth;  // End of month: PM generates "Update Next Step?" badge
            toUpdate.add(o);
            seen.add(o.Id);
            currentTotal++;
            currentOmega++;
            System.debug('  [2a] Restored: ' + o.Name + ' → ' + lastDayMonth);
        }
    }

    // 2b: Non-Omega fill — spread across the rest of the month starting from tomorrow
    if (currentTotal < minTotal) {
        excludeIds = new List<Id>(seen);
        List<Opportunity> staleOpen = [
            SELECT Id, Name, StageName, CloseDate, Account.Name FROM Opportunity
            WHERE OwnerId = :demoOwnerId
              AND IsClosed = false AND CloseDate < :firstDayMonth
              AND Id NOT IN :excludeIds
            ORDER BY CloseDate DESC LIMIT 15
        ];
        System.debug('Step 2b — Stale fill candidates: ' + staleOpen.size());
        for (Opportunity o : staleOpen) {
            if (currentTotal >= minTotal) break;
            Boolean isOmegaOpp = (o.Account != null && o.Account.Name != null && o.Account.Name.containsIgnoreCase('Omega'))
                                 || (o.Name != null && o.Name.containsIgnoreCase('Omega'));
            if (isOmegaOpp) {
                o.CloseDate = lastDayMonth;
                currentOmega++;
            } else {
                // Spread across the rest of the month from tomorrow — never immediately overdue
                o.CloseDate = assignBase.addDays(Math.mod(dayOffset, assignWindow + 1));
                dayOffset += 3;
            }
            toUpdate.add(o);
            seen.add(o.Id);
            currentTotal++;
            System.debug('  [2b] Restored: ' + o.Name + ' → ' + o.CloseDate);
        }
    }

    // STEP 3: Reopen closed non-Omega opps if still under threshold (last resort)
    if (currentTotal < minTotal) {
        excludeIds = new List<Id>(seen);
        Date cutoff = Date.today().addDays(-180);
        List<Opportunity> closedOther = [
            SELECT Id, Name, StageName, CloseDate FROM Opportunity
            WHERE OwnerId = :demoOwnerId
              AND IsClosed = true AND CloseDate >= :cutoff AND CloseDate < :firstDayMonth
              AND Id NOT IN :excludeIds
            ORDER BY CloseDate DESC LIMIT 10
        ];
        System.debug('Step 3 — Closed non-Omega (last 180 days): ' + closedOther.size() + ' found');
        for (Opportunity o : closedOther) {
            if (currentTotal >= minTotal) break;
            o.StageName = reopenStageOther;
            o.CloseDate = assignBase.addDays(Math.mod(dayOffset, assignWindow + 1));
            dayOffset += 3;
            toUpdate.add(o);
            seen.add(o.Id);
            currentTotal++;
            System.debug('  [step3] Reopened: ' + o.Name + ' → Discovery, ' + o.CloseDate);
        }
    }

    System.debug('Summary: updating ' + toUpdate.size() + ' opps → total=' + currentTotal + ', Omega=' + currentOmega);

    if (!toUpdate.isEmpty()) {
        update toUpdate;
        System.debug('REMEDIATED — ' + toUpdate.size() + ' opps moved to current quarter:');
        for (Opportunity o : toUpdate) {
            System.debug('  ✓ ' + o.Name + ' | ' + o.StageName + ' | ' + o.CloseDate);
        }
    } else {
        System.debug('WARNING — Below threshold but no candidates found to move.');
    }
}

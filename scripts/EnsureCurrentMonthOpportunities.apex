// Demo Org Hygiene Agent — Opportunity Remediation
// Moves existing opportunities into current month for demo POV owner. Prioritizes Omega. Does NOT create new records.
// Run via: sf apex run --file scripts/EnsureCurrentMonthOpportunities.apex --target-org <alias>

Id demoOwnerId = '005Wt000004WHt3IAG';  // Jennifer Hynes — demo POV for SDO
Integer minTotal = 8;
Integer minOmega = 2;
String omegaPattern = '%Omega%';
String reopenStageOmega = 'Negotiation';
String reopenStageOther = 'Discovery';

// Use UTC for "current month" so Apex matches the Node.js check (which uses UTC)
Date todayUtc = Datetime.now().dateGmt();
Date firstDayMonth = Date.newInstance(todayUtc.year(), todayUtc.month(), 1);
Date lastDayMonth = firstDayMonth.addMonths(1).addDays(-1);
Integer maxDayOffset = firstDayMonth.daysBetween(lastDayMonth);
// Previous quarter bounds (same as DemoSetup_StalePipeline) so we prefer bringing those opps back first
Integer qMonth = ((todayUtc.month() - 1) / 3) * 3 + 1;
Date firstDayThisQ = Date.newInstance(todayUtc.year(), qMonth, 1);
Date firstDayLastQ = firstDayThisQ.addMonths(-3);
Date lastDayLastQ = firstDayThisQ.addDays(-1);

// --- Count current state (demo POV owner only) ---
List<Opportunity> currentOpps = [
    SELECT Id, Name, Account.Name FROM Opportunity
    WHERE OwnerId = :demoOwnerId
      AND CloseDate >= :firstDayMonth AND CloseDate <= :lastDayMonth AND IsClosed = false
];
Integer currentTotal = currentOpps.size();

Integer currentOmega = 0;
for (Opportunity o : currentOpps) {
    if ((o.Account != null && o.Account.Name != null && o.Account.Name.containsIgnoreCase('Omega')) || (o.Name != null && o.Name.containsIgnoreCase('Omega'))) {
        currentOmega++;
    }
}

System.debug('Current month open opps: ' + currentTotal + ' (Omega: ' + currentOmega + ')');

if (currentTotal >= minTotal && currentOmega >= minOmega) {
    System.debug('PASS — Thresholds met. No remediation needed.');
} else {
    Set<Id> seen = new Set<Id>();
    for (Opportunity o : currentOpps) seen.add(o.Id);

    List<Opportunity> toUpdate = new List<Opportunity>();
    Integer dayOffset = 0;
    List<Id> excludeIds = new List<Id>(seen);

    // STEP 1: Reactivate closed Omega opps (demo POV owner only)
    if (currentOmega < minOmega) {
        List<Opportunity> closedOmega = [
            SELECT Id, Name, StageName, CloseDate, Amount FROM Opportunity
            WHERE OwnerId = :demoOwnerId
              AND (Account.Name LIKE :omegaPattern OR Name LIKE :omegaPattern) AND IsClosed = true
              AND Id NOT IN :excludeIds
            ORDER BY CloseDate DESC LIMIT 5
        ];
        for (Opportunity o : closedOmega) {
            if (currentOmega >= minOmega && currentTotal >= minTotal) break;
            o.StageName = reopenStageOmega;
            // End of month: ensures Omega is never immediately overdue after reactivation.
            // PM won't badge opps that are overdue with Days in Stage = 0.
            o.CloseDate = lastDayMonth;
            toUpdate.add(o);
            seen.add(o.Id);
            currentOmega++;
            currentTotal++;
        }
    }

    // STEP 2: Move stale open opps into current month. Always restore Omega first by querying
    // them explicitly — a general ORDER BY CloseDate ASC can skip Omega if 8+ earlier-dated
    // opps fill the LIMIT before Omega (e.g. 12/30 Omega after 8 opps dated 12/5–12/21).
    if (currentTotal < minTotal || currentOmega < minOmega) {

        // 2a: Omega opps from previous quarter — explicit query so they are ALWAYS restored
        // regardless of how many other overdue opps exist with earlier close dates.
        if (currentOmega < minOmega) {
            excludeIds = new List<Id>(seen);
            List<Opportunity> staleOmegaLastQ = [
                SELECT Id, Name, StageName, CloseDate, Account.Name FROM Opportunity
                WHERE OwnerId = :demoOwnerId
                  AND IsClosed = false AND CloseDate >= :firstDayLastQ AND CloseDate <= :lastDayLastQ
                  AND (Account.Name LIKE :omegaPattern OR Name LIKE :omegaPattern)
                  AND Id NOT IN :excludeIds
                ORDER BY CloseDate DESC LIMIT 5
            ];
            for (Opportunity o : staleOmegaLastQ) {
                if (currentOmega >= minOmega) break;
                // End of month: ensures Omega is never overdue on restore (PM ignores Days Overdue > 0 + Days in Stage = 0)
                o.CloseDate = lastDayMonth;
                toUpdate.add(o);
                seen.add(o.Id);
                currentTotal++;
                currentOmega++;
                System.debug(‘Restoring Omega (prev quarter): ‘ + o.Name);
            }
        }

        // 2b: Non-Omega opps from previous quarter to fill total threshold
        if (currentTotal < minTotal) {
            excludeIds = new List<Id>(seen);
            List<Opportunity> staleOpenLastQ = [
                SELECT Id, Name, StageName, CloseDate, Account.Name FROM Opportunity
                WHERE OwnerId = :demoOwnerId
                  AND IsClosed = false AND CloseDate >= :firstDayLastQ AND CloseDate <= :lastDayLastQ
                  AND Id NOT IN :excludeIds
                ORDER BY CloseDate ASC LIMIT 10
            ];
            for (Opportunity o : staleOpenLastQ) {
                if (currentTotal >= minTotal) break;
                Boolean isOmegaOpp = (o.Account != null && o.Account.Name != null && o.Account.Name.containsIgnoreCase(‘Omega’)) || (o.Name != null && o.Name.containsIgnoreCase(‘Omega’));
                if (isOmegaOpp) {
                    o.CloseDate = lastDayMonth;
                } else {
                    o.CloseDate = firstDayMonth.addDays(Math.mod(dayOffset, maxDayOffset + 1));
                    dayOffset += 3;
                }
                toUpdate.add(o);
                seen.add(o.Id);
                currentTotal++;
                if (isOmegaOpp) currentOmega++;
            }
        }

        // 2c: Other stale open (before current month, outside previous quarter) if still under threshold
        if (currentTotal < minTotal || currentOmega < minOmega) {
            excludeIds = new List<Id>(seen);
            List<Opportunity> staleOpenOther = [
                SELECT Id, Name, StageName, CloseDate, Account.Name FROM Opportunity
                WHERE OwnerId = :demoOwnerId
                  AND IsClosed = false AND CloseDate < :firstDayMonth AND (CloseDate < :firstDayLastQ OR CloseDate > :lastDayLastQ)
                  AND Id NOT IN :excludeIds
                ORDER BY CloseDate ASC LIMIT 10
            ];
            for (Opportunity o : staleOpenOther) {
                if (currentTotal >= minTotal && currentOmega >= minOmega) break;
                Boolean isOmegaOpp = (o.Account != null && o.Account.Name != null && o.Account.Name.containsIgnoreCase(‘Omega’)) || (o.Name != null && o.Name.containsIgnoreCase(‘Omega’));
                o.CloseDate = isOmegaOpp ? lastDayMonth : firstDayMonth.addDays(Math.mod(dayOffset, maxDayOffset + 1));
                if (!isOmegaOpp) dayOffset += 3;
                toUpdate.add(o);
                seen.add(o.Id);
                currentTotal++;
                if (isOmegaOpp) currentOmega++;
            }
        }
    }

    // STEP 3: Reopen closed non-Omega opps from recent quarters
    if (currentTotal < minTotal) {
        excludeIds = new List<Id>(seen);
        Date cutoff = Date.today().addDays(-120);
        List<Opportunity> closedOther = [
            SELECT Id, Name, StageName, CloseDate FROM Opportunity
            WHERE OwnerId = :demoOwnerId
              AND IsClosed = true AND CloseDate >= :cutoff AND CloseDate < :firstDayMonth
              AND Id NOT IN :excludeIds
            ORDER BY CloseDate DESC LIMIT 10
        ];
        for (Opportunity o : closedOther) {
            if (currentTotal >= minTotal) break;
            o.StageName = reopenStageOther;
            o.CloseDate = firstDayMonth.addDays(Math.mod(dayOffset, maxDayOffset + 1));
            dayOffset += 3;
            toUpdate.add(o);
            seen.add(o.Id);
            currentTotal++;
        }
    }

    if (!toUpdate.isEmpty()) {
        update toUpdate;
        System.debug('REMEDIATED — Updated ' + toUpdate.size() + ' opportunities.');
        for (Opportunity o : toUpdate) {
            System.debug('  > ' + o.Name + ' | Stage: ' + o.StageName + ' | CloseDate: ' + o.CloseDate);
        }
    } else {
        System.debug('WARNING — Below threshold but no candidates found to move.');
    }
}

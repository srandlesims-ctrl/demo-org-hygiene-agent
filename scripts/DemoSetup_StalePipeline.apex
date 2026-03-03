// Demo prep: Move Jennifer Hynes's current-quarter open opps to PREVIOUS quarter.
// Omega opps get the LATEST dates (Dec 31, 30, 29...) sorted by Amount DESC so the
// highest-value Omega opp (128K) is always first in EnsureCurrentMonthOpportunities'
// ORDER BY CloseDate DESC restore query — guaranteed regardless of how many Omega opps exist.
// Run: sf apex run --file scripts/DemoSetup_StalePipeline.apex --target-org <alias>

Id jenniferId = '005Wt000004WHt3IAG';  // Jennifer Hynes

Date today = Date.today();
Integer qMonth = ((today.month() - 1) / 3) * 3 + 1;  // 1,4,7,10
Date firstDayThisQ = Date.newInstance(today.year(), qMonth, 1);
Date lastDayThisQ = firstDayThisQ.addMonths(3).addDays(-1);

Date firstDayLastQ = firstDayThisQ.addMonths(-3);
Date lastDayLastQ = firstDayThisQ.addDays(-1);
Integer daysInLastQ = firstDayLastQ.daysBetween(lastDayLastQ);

List<Opportunity> opps = [
    SELECT Id, Name, CloseDate, NextStep, Amount, Account.Name
    FROM Opportunity
    WHERE OwnerId = :jenniferId
      AND CloseDate >= :firstDayThisQ
      AND CloseDate <= :lastDayThisQ
      AND IsClosed = false
];

if (opps.isEmpty()) {
    System.debug('No open opps for Jennifer Hynes in current quarter to move.');
    return;
}

// Separate Omega (by opp name OR account name) vs non-Omega
List<Opportunity> omegaOpps = new List<Opportunity>();
List<Opportunity> otherOpps = new List<Opportunity>();
for (Opportunity o : opps) {
    Boolean isOmega = (o.Name != null && o.Name.containsIgnoreCase('Omega'))
                   || (o.Account != null && o.Account.Name != null && o.Account.Name.containsIgnoreCase('Omega'));
    if (isOmega) {
        omegaOpps.add(o);
    } else {
        otherOpps.add(o);
    }
}

// Sort Omega opps by Amount DESC (bubble sort — anonymous Apex has no Comparator).
// Highest-value opp (128K) ends up first → gets Dec 31 (latest date) → ORDER BY CloseDate DESC
// in EnsureCurrentMonthOpportunities always restores the highest-value Omega opp first.
for (Integer i = 0; i < omegaOpps.size() - 1; i++) {
    for (Integer j = 0; j < omegaOpps.size() - 1 - i; j++) {
        Decimal a1 = omegaOpps[j].Amount != null ? omegaOpps[j].Amount : 0;
        Decimal a2 = omegaOpps[j+1].Amount != null ? omegaOpps[j+1].Amount : 0;
        if (a1 < a2) {
            Opportunity tmp = omegaOpps[j];
            omegaOpps[j] = omegaOpps[j+1];
            omegaOpps[j+1] = tmp;
        }
    }
}

// Non-Omega → early dates in previous quarter (reserve last 15 days for Omega)
Integer safeWindow = Math.max(daysInLastQ - 15, 0);
Integer dayOffset = 0;
for (Opportunity o : otherOpps) {
    o.CloseDate = firstDayLastQ.addDays(Math.mod(dayOffset, safeWindow + 1));
    dayOffset += 5;
}

// Omega → late dates descending from end of previous quarter (Dec 31, Dec 30, Dec 29...)
// sorted by Amount DESC so 128K always gets Dec 31.
// Clear NextStep so Pipeline Management generates "Update Next Step?" badge on restore.
Integer omegaOffset = 0;
for (Opportunity o : omegaOpps) {
    o.CloseDate = lastDayLastQ.addDays(-omegaOffset);  // Dec 31, Dec 30, Dec 29...
    omegaOffset++;
    o.NextStep = null;
}

update opps;
System.debug('Moved ' + opps.size() + ' opps to prev quarter (' + firstDayLastQ + ' → ' + lastDayLastQ + ').');
System.debug('  Omega (' + omegaOpps.size() + ') sorted by Amount DESC → late dates:');
for (Opportunity o : omegaOpps) {
    System.debug('    ' + o.Name + ' | $' + o.Amount + ' | CloseDate: ' + o.CloseDate);
}
System.debug('  Other (' + otherOpps.size() + ') → early dates (' + firstDayLastQ + ' + spread)');

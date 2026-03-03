// Demo prep: Move Jennifer Hynes's current-quarter open opps to PREVIOUS quarter.
// Run before the demo so the hygiene agent can "fix" them back to current quarter.
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
    SELECT Id, Name, CloseDate, NextStep, Account.Name
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

// Separate Omega vs non-Omega. Omega opps get the LATEST dates in the previous quarter
// (Dec 31, 30, 29...) so EnsureCurrentMonthOpportunities ORDER BY CloseDate DESC always
// picks them up first in Step 2a — regardless of how many other overdue opps exist.
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

// Non-Omega → early dates in previous quarter (first ~75% of Q4)
Integer safeWindow = Math.max(daysInLastQ - 15, 0);  // Reserve last 15 days for Omega
Integer dayOffset = 0;
for (Opportunity o : otherOpps) {
    o.CloseDate = firstDayLastQ.addDays(Math.mod(dayOffset, safeWindow + 1));
    dayOffset += 5;
}

// Omega → late dates descending from end of previous quarter (Dec 31, Dec 30, Dec 29...)
// Clear NextStep so Pipeline Management generates "Update Next Step?" on restore.
Integer omegaOffset = 0;
for (Opportunity o : omegaOpps) {
    o.CloseDate = lastDayLastQ.addDays(-omegaOffset);  // Dec 31, Dec 30, Dec 29...
    omegaOffset++;
    o.NextStep = null;
}

update opps;
System.debug('Moved ' + opps.size() + ' opps (Jennifer Hynes) to previous quarter for demo.');
System.debug('  Omega (' + omegaOpps.size() + '): late Q4 dates so restore always picks them first');
System.debug('  Other (' + otherOpps.size() + '): early Q4 dates');

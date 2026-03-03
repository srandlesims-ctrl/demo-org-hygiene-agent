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

List<Opportunity> opps = [
    SELECT Id, Name, CloseDate, NextStep
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

Integer dayOffset = 0;
Integer daysInLastQ = firstDayLastQ.daysBetween(lastDayLastQ);
for (Opportunity o : opps) {
    o.CloseDate = firstDayLastQ.addDays(Math.mod(dayOffset, daysInLastQ + 1));
    dayOffset += 5;
    // Clear NextStep on Omega opps so Pipeline Management generates "Update Next Step?"
    // when demo:after restores them. Other opps keep their NextStep (PM still badges them).
    if (o.Name != null && o.Name.containsIgnoreCase('Omega')) {
        o.NextStep = null;
    }
}
update opps;
System.debug('Moved ' + opps.size() + ' opps (Jennifer Hynes) from current quarter to previous quarter for demo.');

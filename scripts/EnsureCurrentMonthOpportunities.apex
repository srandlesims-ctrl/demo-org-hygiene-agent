// Creates sample Opportunities with Close Date in the current month if needed.
// Run via: sf apex run --file scripts/EnsureCurrentMonthOpportunities.apex --target-org <alias>

Date today = Date.today();
Integer need = 8;
List<Opportunity> existing = [
    SELECT Id
    FROM Opportunity
    WHERE CloseDate >= :today.toStartOfMonth()
    AND CloseDate <= :today.addMonths(1).toStartOfMonth().addDays(-1)
    AND IsClosed = false
    LIMIT 20
];
if (existing.size() >= need) {
    System.debug('Already have ' + existing.size() + ' open opportunities this month.');
    return;
}

Id userId = UserInfo.getUserId();
List<Opportunity> toInsert = new List<Opportunity>();
Date closeDate = today.toStartOfMonth().addDays(14);
for (Integer i = 0; i < need - existing.size(); i++) {
    toInsert.add(new Opportunity(
        Name = 'Demo Opp ' + closeDate.format() + ' - ' + i,
        StageName = 'Prospecting',
        CloseDate = closeDate.addDays(i * 2),
        Amount = 25000 + (i * 5000),
        OwnerId = userId
    ));
}
insert toInsert;
System.debug('Created ' + toInsert.size() + ' opportunities for current month.');

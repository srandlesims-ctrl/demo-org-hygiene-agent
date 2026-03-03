// Demo prep: Close the Omega 128K deal so the hygiene agent can "reactivate" it in the demo.
// Run: sf apex run --file scripts/DemoSetup_CloseOmega128K.apex --target-org <alias>

List<Opportunity> omega = [
    SELECT Id, Name, StageName, CloseDate
    FROM Opportunity
    WHERE (Name LIKE '%Omega%' AND (Name LIKE '%128%' OR Name LIKE '%128K%'))
    AND IsClosed = false
    LIMIT 5
];

if (omega.isEmpty()) {
    System.debug('No open Omega 128K deal found. Check Name/Amount.');
    return;
}

for (Opportunity o : omega) {
    o.StageName = 'Closed Won';
    o.CloseDate = Date.today().addMonths(-1);  // e.g. last month
}
update omega;
System.debug('Closed ' + omega.size() + ' Omega 128K deal(s) for demo.');

// Creates sample Events in the next 14 days if needed.
// Run via: sf apex run --file scripts/EnsureUpcomingEvents.apex --target-org <alias>

Integer need = 5;
Date today = Date.today();
DateTime startRange = DateTime.newInstance(today, Time.newInstance(9, 0, 0, 0));
DateTime endRange = startRange.addDays(14);

List<Event> existing = [
    SELECT Id
    FROM Event
    WHERE StartDateTime >= :startRange
    AND StartDateTime <= :endRange
    AND OwnerId = :UserInfo.getUserId()
    LIMIT 20
];
if (existing.size() >= need) {
    System.debug('Already have ' + existing.size() + ' events in next 14 days.');
    return;
}

Id userId = UserInfo.getUserId();
List<String> subjects = new List<String>{
    'Pipeline Review - Omega, Inc',
    'Discovery Call - Acme Corp',
    'QBR Prep - Internal',
    'Demo Follow-up - Omega, Inc',
    'Forecast Meeting - Sales Team'
};
List<Event> toInsert = new List<Event>();
for (Integer i = 0; i < need - existing.size(); i++) {
    DateTime startDt = startRange.addDays(i).addHours(i);
    String subj = i < subjects.size() ? subjects[i] : ('Demo Event ' + startDt.format('yyyy-MM-dd'));
    toInsert.add(new Event(
        Subject = subj,
        StartDateTime = startDt,
        EndDateTime = startDt.addHours(1),
        OwnerId = userId
    ));
}
insert toInsert;
System.debug('Created ' + toInsert.size() + ' upcoming events.');

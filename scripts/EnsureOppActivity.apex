// Demo Org Hygiene Agent — Activity remediation
// Ensures open Omega opps have recent activity on the timeline (Tasks).
// Creates Tasks if no activity in the last 30 days.
// Run via: sf apex run --file scripts/EnsureOppActivity.apex --target-org <alias>

String omegaPattern = '%Omega%';
Date thirtyDaysAgo = Date.today().addDays(-30);
Date firstDayMonth = Date.today().toStartOfMonth();
Date lastDayMonth = firstDayMonth.addMonths(1).addDays(-1);

List<Opportunity> opps = [
    SELECT Id, Name,
      (SELECT Id FROM Tasks WHERE CreatedDate >= :thirtyDaysAgo LIMIT 1)
    FROM Opportunity
    WHERE Account.Name LIKE :omegaPattern
      AND IsClosed = false
      AND CloseDate >= :firstDayMonth
      AND CloseDate <= :lastDayMonth
];

List<Task> newTasks = new List<Task>();
List<String> subjects = new List<String>{
    'Reviewed proposal with stakeholders',
    'Follow-up call scheduled with champion',
    'Updated pricing based on procurement feedback',
    'Sent ROI analysis to economic buyer',
    'Internal deal review completed',
    'Technical requirements confirmed',
    'Legal review of contract terms initiated'
};

Integer subjectIndex = 0;
for (Opportunity opp : opps) {
    if (opp.Tasks == null || opp.Tasks.isEmpty()) {
        for (Integer i = 0; i < 3 && subjectIndex < subjects.size(); i++) {
            Task t = new Task();
            t.WhatId = opp.Id;
            t.Subject = subjects[subjectIndex];
            t.Status = 'Completed';
            t.Priority = 'Normal';
            t.ActivityDate = Date.today().addDays(-Math.mod(subjectIndex * 3, 14));
            newTasks.add(t);
            subjectIndex++;
        }
        System.debug('Adding activity to: ' + opp.Name);
    }
}

if (!newTasks.isEmpty()) {
    insert newTasks;
    System.debug('Created ' + newTasks.size() + ' tasks across Omega opps.');
} else {
    System.debug('PASS — All Omega opps have recent activity.');
}

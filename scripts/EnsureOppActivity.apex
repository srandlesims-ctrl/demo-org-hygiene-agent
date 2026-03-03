// Demo Org Hygiene Agent — Activity remediation for Pipeline Management Agent Activity
// Ensures every open opportunity in the current quarter (owned by demo POV user) has recent Tasks:
// 2 per non-Omega opp, 3 per Omega opp; ActivityDate spread over the last 7 days for signal diversity.
// Run via: sf apex run --file scripts/EnsureOppActivity.apex --target-org <alias>

Id demoOwnerId = '005Wt000004WHt3IAG';  // Jennifer Hynes — demo POV for SDO
String omegaPattern = '%Omega%';
Integer recentDays = 30;
Date cutoff = Date.today().addDays(-recentDays);

// Current quarter (UTC) to match Pipeline Inspection "This Quarter"
Datetime nowUtc = Datetime.now();
Integer y = nowUtc.year();
Integer m = nowUtc.month();
Integer q = (m - 1) / 3 + 1;
Integer startMonth = (q - 1) * 3 + 1;
Integer endMonth = q * 3;
Date firstDayQuarter = Date.newInstance(y, startMonth, 1);
Date lastDayQuarter = Date.newInstance(y, endMonth, 1).addMonths(1).addDays(-1);

List<Opportunity> opps = [
    SELECT Id, Name, Account.Name,
      (SELECT Id FROM Tasks WHERE CreatedDate >= :cutoff LIMIT 1)
    FROM Opportunity
    WHERE IsClosed = false
      AND OwnerId = :demoOwnerId
      AND CloseDate >= :firstDayQuarter
      AND CloseDate <= :lastDayQuarter
];

List<Task> newTasks = new List<Task>();
List<String> subjects = new List<String>{
    'Reviewed proposal with stakeholders',
    'Follow-up call scheduled with champion',
    'Updated pricing based on procurement feedback',
    'Sent ROI analysis to economic buyer',
    'Internal deal review completed',
    'Technical requirements confirmed',
    'Legal review of contract terms initiated',
    'Discovery call completed',
    'Stakeholder mapping updated',
    'Next steps agreed with champion',
    'Executive sponsor meeting scheduled',
    'Contract redline sent to legal',
    'Reference call completed',
    'Demo follow-up with technical team'
};

Integer subjectIndex = 0;
for (Opportunity opp : opps) {
    if (opp.Tasks == null || opp.Tasks.isEmpty()) {
        Boolean isOmega = (opp.Account.Name != null && opp.Account.Name.contains('Omega')) || (opp.Name != null && opp.Name.contains('Omega'));
        Integer tasksToAdd = isOmega ? 3 : 2;
        for (Integer i = 0; i < tasksToAdd && subjectIndex < subjects.size(); i++) {
            Task t = new Task();
            t.WhatId = opp.Id;
            t.Subject = subjects[subjectIndex];
            t.Status = 'Completed';
            t.Priority = 'Normal';
            t.ActivityDate = Date.today().addDays(-(1 + Math.mod(subjectIndex, 7)));
            newTasks.add(t);
            subjectIndex++;
        }
        if (subjectIndex >= subjects.size()) subjectIndex = 0;
        System.debug('Adding activity to: ' + opp.Name);
    }
}

if (!newTasks.isEmpty()) {
    insert newTasks;
    System.debug('Created ' + newTasks.size() + ' task(s) on open current-quarter opps for Agent Activity.');
} else {
    System.debug('PASS — All open current-quarter opps have recent activity.');
}

// Demo Org Hygiene Agent — Notes remediation for Pipeline Management Agent Activity
// Ensures every open opportunity in the current quarter (owned by demo POV) has at least two
// recent Enhanced Notes when none exist. Pipeline Management uses Notes + Tasks + email/calls for insights.
// Run via: sf apex run --file scripts/EnsureOppNotes.apex --target-org <alias>

Id demoOwnerId = '005Wt000004WHt3IAG';  // Jennifer Hynes — demo POV for SDO
Integer recentDays = 30;
Datetime cutoff = Datetime.now().addDays(-recentDays);

// Current quarter (UTC)
Datetime nowUtc = Datetime.now();
Integer y = nowUtc.year();
Integer m = nowUtc.month();
Integer q = (m - 1) / 3 + 1;
Integer startMonth = (q - 1) * 3 + 1;
Integer endMonth = q * 3;
Date firstDayQuarter = Date.newInstance(y, startMonth, 1);
Date lastDayQuarter = Date.newInstance(y, endMonth, 1).addMonths(1).addDays(-1);

List<Opportunity> opps = [
    SELECT Id, Name, Account.Name
    FROM Opportunity
    WHERE IsClosed = false
      AND OwnerId = :demoOwnerId
      AND CloseDate >= :firstDayQuarter
      AND CloseDate <= :lastDayQuarter
];

if (opps.isEmpty()) {
    System.debug('No open current-quarter opps for demo owner.');
    return;
}

Set<Id> oppIds = new Set<Id>();
for (Opportunity o : opps) oppIds.add(o.Id);

// Opps that already have a Note (ContentVersion with FirstPublishLocationId = opp) created in last N days
Set<Id> oppIdsWithRecentNote = new Set<Id>();
for (ContentVersion cv : [
    SELECT FirstPublishLocationId FROM ContentVersion
    WHERE FirstPublishLocationId IN :oppIds
      AND PathOnClient LIKE '%.snote'
      AND CreatedDate >= :cutoff
      AND IsLatest = true
]) {
    if (cv.FirstPublishLocationId != null) oppIdsWithRecentNote.add(cv.FirstPublishLocationId);
}

List<ContentVersion> newNotes = new List<ContentVersion>();
List<String> titles = new List<String>{
    'Pipeline review notes',
    'Next steps from last call',
    'Stakeholder check-in',
    'Pricing and timeline discussion',
    'Follow-up and action items',
    'Discovery summary',
    'Champion feedback',
    'Internal alignment notes',
    'ROI one-pager sent',
    'Technical validation scheduled'
};
List<String> bodies = new List<String>{
    'Reviewed deal with team. Champion confirmed budget timeline. Send proposal by end of week.',
    'Key next steps: schedule technical validation, get procurement on the call. Customer targeting close this quarter.',
    'Spoke with economic buyer. They want to see ROI before final sign-off. Preparing one-pager.',
    'Discussed pricing and implementation timeline. Customer asked for references in their industry.',
    'Action items: send contract redline, schedule legal review, confirm go-live date with customer.',
    'Discovery summary: pain points around reporting and integrations. Demo covered both. Strong interest.',
    'Champion feedback: liked the roadmap. Concern about support during rollout. Highlight success stories next.',
    'Internal alignment: AE and SE agreed on approach. Ready for exec sponsor meeting.',
    'Sent ROI one-pager. Economic buyer requested comparison to current solution. Delivered same day.',
    'Technical validation on the calendar. SE and customer architect will run through integration scenarios.'
};

Integer idx = 0;
for (Opportunity o : opps) {
    if (oppIdsWithRecentNote.contains(o.Id)) continue;
    for (Integer n = 0; n < 2; n++) {
        Integer k = Math.mod(idx * 2 + n, titles.size());
        String title = titles[k];
        String body = bodies[k];
        String safeName = title.replaceAll('[\\\\/:*?\"<>|]', '_') + (n == 0 ? '' : '_2');
        newNotes.add(new ContentVersion(
            Title = title,
            PathOnClient = safeName + '.snote',
            VersionData = Blob.valueOf(body),
            FirstPublishLocationId = o.Id
        ));
    }
    idx++;
    System.debug('Adding 2 notes to: ' + o.Name);
}

if (!newNotes.isEmpty()) {
    insert newNotes;
    System.debug('Created ' + newNotes.size() + ' Enhanced Note(s) on open current-quarter opps.');
} else {
    System.debug('PASS — All open current-quarter opps already have a recent Note.');
}

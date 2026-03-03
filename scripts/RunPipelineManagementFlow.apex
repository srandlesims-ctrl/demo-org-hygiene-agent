// Runs the Pipeline Management flow with record context for all open current-quarter opps
// owned by the demo POV user (e.g. Jennifer Hynes). Same scope as hygiene (Tasks + Notes).
// Run: sf apex run --file scripts/RunPipelineManagementFlow.apex --target-org <alias>

Id demoOwnerId = '005Wt000004WHt3IAG';  // Jennifer Hynes — demo POV for SDO
Date today = Date.today();
Date ninetyDaysOut = today.addDays(90);

// Current quarter bounds (match Pipeline Inspection "This Quarter" and hygiene scripts)
Integer y = today.year();
Integer m = today.month();
Integer q = (m - 1) / 3 + 1;
Integer startMonth = (q - 1) * 3 + 1;
Integer endMonth = q * 3;
Date firstDayQuarter = Date.newInstance(y, startMonth, 1);
Date lastDayQuarter = Date.newInstance(y, endMonth, 1).addMonths(1).addDays(-1);

// All open current-quarter opps for demo POV (up to 25 to cover threshold + headroom, avoid CPU limit)
List<Opportunity> opps = [
    SELECT Id, Name
    FROM Opportunity
    WHERE OwnerId = :demoOwnerId
      AND IsClosed = false
      AND CloseDate >= :firstDayQuarter
      AND CloseDate <= :lastDayQuarter
    ORDER BY CloseDate ASC
    LIMIT 25
];

if (opps.isEmpty()) {
    System.debug('No open current-quarter opportunities for demo POV.');
    return;
}

// Run flow with recordId so it runs in the same context as the oppty button (Setup > Opportunity > Buttons).
Integer started = 0;
Boolean useRecordId = true;
try {
    for (Opportunity o : opps) {
        Map<String, Object> inputs = new Map<String, Object>();
        inputs.put('recordId', o.Id);
        Flow.Interview.SDO_Process_Field_Updates_Autolaunch flow =
            new Flow.Interview.SDO_Process_Field_Updates_Autolaunch(inputs);
        flow.start();
        started++;
        System.debug('Started flow for: ' + o.Name);
    }
} catch (Exception e) {
    System.debug('With recordId: ' + e.getMessage() + ' — running once with no inputs (flow may have no recordId input).');
    useRecordId = false;
}
if (!useRecordId) {
    Flow.Interview.SDO_Process_Field_Updates_Autolaunch flow2 =
        new Flow.Interview.SDO_Process_Field_Updates_Autolaunch(new Map<String, Object>());
    flow2.start();
    started = 1;
}
System.debug('Pipeline Management flow started ' + started + ' time(s). Check Pipeline Inspection > Agent Activity in a few minutes. If still None, ensure opps have Notes/email/call in last 24h.');

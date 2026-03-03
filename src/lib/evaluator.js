/**
 * Pass/fail evaluator: compare check results to thresholds.
 */

/**
 * @typedef {Object} CheckResult
 * @property {string} orgAlias
 * @property {number|null} opportunitiesCurrentMonth
 * @property {number|null} opportunitiesOmegaCurrentMonth
 * @property {boolean|null} omegaFlagshipOpen
 * @property {number|null} eventsUpcoming
 * @property {boolean|null} activityOmegaOk
 * @property {number|null} openCurrentQuarterTotal
 * @property {number|null} openCurrentQuarterWithActivity
 * @property {boolean|null} agentActivityReady
 * @property {string[]} errors
 */

/**
 * @typedef {Object} EvalResult
 * @property {string} orgAlias
 * @property {boolean} pass
 * @property {string[]} failures
 * @property {Object} details
 */

/**
 * Evaluate hygiene check results against thresholds.
 * Agent FAILS if Omega opps are below threshold or flagship is missing, even if total count passes.
 * @param {CheckResult} result - From checks.runHygieneChecks
 * @param {Object} thresholds - From config/thresholds.json
 * @returns {EvalResult}
 */
export function evaluate(result, thresholds) {
  const failures = [];
  const details = {
    opportunitiesCurrentMonth: result.opportunitiesCurrentMonth,
    opportunitiesOmegaCurrentMonth: result.opportunitiesOmegaCurrentMonth,
    omegaFlagshipOpen: result.omegaFlagshipOpen,
    eventsUpcoming: result.eventsUpcoming,
    activityOmegaOk: result.activityOmegaOk,
    openCurrentQuarterTotal: result.openCurrentQuarterTotal,
    openCurrentQuarterWithActivity: result.openCurrentQuarterWithActivity,
    agentActivityReady: result.agentActivityReady,
    _monthBounds: result._monthBounds,
    _quarterBounds: result._quarterBounds,
  };

  if (result.errors.length > 0) {
    failures.push(`Query errors: ${result.errors.join('; ')}`);
    return { orgAlias: result.orgAlias, pass: false, failures, details };
  }

  const minOpps = thresholds?.opportunities?.minCurrentMonth ?? 3;
  if (result.opportunitiesCurrentMonth !== null && result.opportunitiesCurrentMonth < minOpps) {
    failures.push(`Opportunities (current month): ${result.opportunitiesCurrentMonth} < ${minOpps} required`);
  }

  const minOmega = thresholds?.opportunities?.minOmega ?? 2;
  if (result.opportunitiesOmegaCurrentMonth !== null && result.opportunitiesOmegaCurrentMonth < minOmega) {
    failures.push(`Omega opps (current month): ${result.opportunitiesOmegaCurrentMonth} < ${minOmega} required`);
  }

  if (result.omegaFlagshipOpen === false) {
    failures.push('Omega flagship opp ("Omega, Inc. - New Business") not open in current month');
  }

  const minEvents = thresholds?.events?.minCount ?? 5;
  if (result.eventsUpcoming !== null && result.eventsUpcoming < minEvents) {
    failures.push(`Events (upcoming ${thresholds?.events?.minUpcomingDays ?? 14} days): ${result.eventsUpcoming} < ${minEvents} required`);
  }

  if (result.activityOmegaOk === false) {
    failures.push('Some open Omega opps have no recent activity (last 30 days)');
  }

  const requireAllForAgent = thresholds?.activity?.requireAllCurrentQuarterForAgent !== false;
  if (result.agentActivityReady === false) {
    const total = result.openCurrentQuarterTotal ?? 0;
    const withActivity = result.openCurrentQuarterWithActivity ?? 0;
    const minOmega = thresholds?.opportunities?.minOmega ?? 2;
    const relaxedPass = !requireAllForAgent && withActivity >= minOmega;
    if (!relaxedPass) {
      failures.push(
        `Pipeline Management Agent Activity: ${withActivity}/${total} open current-quarter opps have recent activity${requireAllForAgent ? ' (all need activity for insights)' : ` (at least ${minOmega} required)`}`
      );
    }
  }

  return {
    orgAlias: result.orgAlias,
    pass: failures.length === 0,
    failures,
    details,
  };
}

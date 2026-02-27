/**
 * Pass/fail evaluator: compare check results to thresholds.
 */

/**
 * @typedef {Object} CheckResult
 * @property {string} orgAlias
 * @property {number|null} opportunitiesCurrentMonth
 * @property {number|null} eventsUpcoming
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
 * @param {CheckResult} result - From checks.runHygieneChecks
 * @param {Object} thresholds - From config/thresholds.json
 * @returns {EvalResult}
 */
export function evaluate(result, thresholds) {
  const failures = [];
  const details = {
    opportunitiesCurrentMonth: result.opportunitiesCurrentMonth,
    eventsUpcoming: result.eventsUpcoming,
  };

  if (result.errors.length > 0) {
    failures.push(`Query errors: ${result.errors.join('; ')}`);
    return { orgAlias: result.orgAlias, pass: false, failures, details };
  }

  const minOpps = thresholds?.opportunities?.minCurrentMonth ?? 3;
  if (result.opportunitiesCurrentMonth !== null && result.opportunitiesCurrentMonth < minOpps) {
    failures.push(`Opportunities (current month): ${result.opportunitiesCurrentMonth} < ${minOpps} required`);
  }

  const minEvents = thresholds?.events?.minCount ?? 5;
  if (result.eventsUpcoming !== null && result.eventsUpcoming < minEvents) {
    failures.push(`Events (upcoming ${thresholds?.events?.minUpcomingDays ?? 14} days): ${result.eventsUpcoming} < ${minEvents} required`);
  }

  return {
    orgAlias: result.orgAlias,
    pass: failures.length === 0,
    failures,
    details,
  };
}

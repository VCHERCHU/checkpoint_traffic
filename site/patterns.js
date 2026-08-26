/* Time-of-day / day-of-week congestion expectations.
 *
 * IMPORTANT: this table is HAND-WRITTEN JUDGEMENT, not a measurement. Nothing
 * here is derived from data. It exists only as a fallback for when the cameras
 * cannot be read (night, heavy rain, a dead lens), so that the app degrades to
 * "what this crossing is usually like right now" instead of guessing or going
 * blank.
 *
 * The shape of the traffic it encodes:
 *   - Malaysians commute INTO Singapore on weekday mornings and back OUT in the
 *     evening, so weekday peaks are inbound-heavy early, outbound-heavy late.
 *   - Singaporeans head TO Malaysia on Friday evening and Saturday morning, and
 *     come back Sunday afternoon and evening.
 *   - Tuas is the relief valve: busy at the same times, but consistently lighter
 *     than the Causeway.
 *
 * KNOWN GAP: public holidays are not modelled. Eves of Singapore and Johor
 * public holidays are among the worst times to cross and this table will
 * under-read them. Adding a holiday list would be a real improvement.
 *
 * Scores use the same 0-10 scale the vision model uses.
 */
(function (global) {
  'use strict';

  // Tuas runs lighter than Woodlands at equivalent times.
  var TUAS_RATIO = 0.65;

  function inWindow(hour, from, to) {
    return hour >= from && hour < to;
  }

  // Expected Woodlands congestion, 0-10, for a given day/hour/direction.
  function woodlands(day, hour, direction) {
    var isFri = day === 5;
    var isSat = day === 6;
    var isSun = day === 0;
    var isWeekday = day >= 1 && day <= 5;

    if (inWindow(hour, 0, 5)) return 2; // overnight lull, both directions

    if (direction === 'outbound') {
      if (isFri && inWindow(hour, 15, 23)) return 9;  // the worst slot of the week
      if (isSat && inWindow(hour, 5, 12)) return 8;
      if (isSun && inWindow(hour, 5, 11)) return 6;
      if (isWeekday && inWindow(hour, 17, 21)) return 7; // commuters heading home to JB
      if (isSat || isSun) return 5;
      return 4;
    }

    // inbound
    if (isWeekday && inWindow(hour, 5, 9)) return 8;   // the daily commute into SG
    if (isSun && inWindow(hour, 15, 23)) return 8;     // weekend returns
    if (isSat && inWindow(hour, 15, 22)) return 6;
    if (isWeekday && inWindow(hour, 9, 12)) return 5;
    return 4;
  }

  /**
   * Expected congestion for a checkpoint at a moment in time.
   * @param {string} checkpoint 'woodlands' | 'tuas'
   * @param {string} direction  'outbound' | 'inbound'
   * @param {Date}   when       a Date already in Singapore time
   * @returns {number} 0-10
   */
  function expected(checkpoint, direction, when) {
    var base = woodlands(when.getDay(), when.getHours(), direction);
    if (checkpoint === 'tuas') {
      return Math.max(1, Math.round(base * TUAS_RATIO * 10) / 10);
    }
    return base;
  }

  global.PATTERNS = { expected: expected };
})(window);

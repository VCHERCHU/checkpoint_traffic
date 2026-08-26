/* Checkpoint Traffic — client.
 *
 * Reads the analysis published by the GitHub Actions session, adds the user's
 * own origin/destination, and renders one recommendation with its evidence.
 *
 * Everything the model could not judge confidently falls back to PATTERNS.
 */
(function () {
  'use strict';

  var DATA_URL =
    'https://raw.githubusercontent.com/VCHERCHU/checkpoint_traffic/data/analysis.json';

  // ---- Tunable judgement constants -------------------------------------
  // How many "penalty minutes" one point of congestion is worth. At 6, a
  // maxed-out 10/10 queue costs the same as an hour of extra driving. This is a
  // judgement call about how much you hate queueing, not a measurement.
  var QUEUE_WEIGHT = 6;
  // Assumed average speed for turning straight-line distance into minutes.
  // Straight-line under-reads real road distance, which partly cancels the
  // optimism of assuming expressway speed the whole way.
  var ASSUMED_KMH = 60;
  // Below this confidence the camera reading is not trusted and the
  // time-of-day pattern is used instead.
  var CONFIDENCE_FLOOR = 0.5;
  // A verdict closer than this is reported as "much the same".
  var TOSSUP_MARGIN = 8;
  // Only show a trend arrow if the comparison point is this recent.
  var TREND_MAX_AGE_MIN = 35;

  var state = {
    data: null,
    direction: 'outbound',
    origin: null,
    dest: null
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---- Time -------------------------------------------------------------

  // A Date whose local getters read Singapore wall-clock values.
  function sgNow() {
    var d = new Date();
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
  }

  function minutesSince(iso) {
    if (!iso) return null;
    return (Date.now() - new Date(iso).getTime()) / 60000;
  }

  function ago(mins) {
    if (mins === null) return 'unknown';
    if (mins < 1) return 'just now';
    if (mins < 60) return Math.round(mins) + ' min ago';
    var h = Math.floor(mins / 60);
    return h + (h === 1 ? ' hour ' : ' hours ') + Math.round(mins % 60) + ' min ago';
  }

  // ---- Geometry ---------------------------------------------------------

  function haversineKm(a, b) {
    var R = 6371;
    var toRad = function (x) { return (x * Math.PI) / 180; };
    var dLat = toRad(b[0] - a[0]);
    var dLon = toRad(b[1] - a[1]);
    var s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function driveMinutes(km) {
    return (km / ASSUMED_KMH) * 60;
  }

  // ---- Geocoding (Nominatim) -------------------------------------------
  // Policy: max 1 request/second, and a browser supplies Referer automatically.
  // We only geocode on explicit submit — never per keystroke — and cache every
  // resolved place so repeat trips cost nothing.

  function cacheGet(q) {
    try {
      var raw = localStorage.getItem('geo:' + q.toLowerCase().trim());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function cacheSet(q, val) {
    try { localStorage.setItem('geo:' + q.toLowerCase().trim(), JSON.stringify(val)); }
    catch (e) { /* private mode, quota — not worth failing over */ }
  }

  function geocode(q) {
    var hit = cacheGet(q);
    if (hit) return Promise.resolve(hit);
    var url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1' +
      '&countrycodes=sg,my&q=' + encodeURIComponent(q);
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (rows) {
        if (!rows.length) return null;
        var out = {
          coords: [parseFloat(rows[0].lat), parseFloat(rows[0].lon)],
          label: rows[0].display_name
        };
        cacheSet(q, out);
        return out;
      })
      .catch(function () { return null; });
  }

  // ---- Scoring ----------------------------------------------------------

  function readingFor(key, cp) {
    var r = cp[state.direction] || {};
    var usedPattern = r.congestion === null || r.confidence < CONFIDENCE_FLOOR;
    var congestion = usedPattern
      ? PATTERNS.expected(key, state.direction, sgNow())
      : r.congestion;
    return {
      congestion: congestion,
      label: r.label,
      confidence: r.confidence,
      usedPattern: usedPattern
    };
  }

  function travelFor(cp) {
    var toCp = state.origin ? driveMinutes(haversineKm(state.origin.coords, cp.coords)) : 0;
    var onward = state.dest ? driveMinutes(haversineKm(cp.coords, state.dest.coords)) : 0;
    return { toCp: toCp, onward: onward, total: toCp + onward };
  }

  function score(key, cp) {
    var reading = readingFor(key, cp);
    var travel = travelFor(cp);
    return {
      key: key,
      cp: cp,
      reading: reading,
      travel: travel,
      penalty: QUEUE_WEIGHT * reading.congestion + travel.total
    };
  }

  function trendFor(key) {
    var hist = (state.data && state.data.history) || [];
    if (hist.length < 2) return null;
    var field = key + '_' + state.direction;
    var latest = hist[hist.length - 1];
    if (latest[field] === null || latest[field] === undefined) return null;
    for (var i = hist.length - 2; i >= 0; i--) {
      var e = hist[i];
      if (e[field] === null || e[field] === undefined) continue;
      var gap = (new Date(latest.t) - new Date(e.t)) / 60000;
      if (gap > TREND_MAX_AGE_MIN) break;
      if (gap < 8) continue; // too close together to mean anything
      var delta = latest[field] - e[field];
      if (Math.abs(delta) < 0.8) return { dir: 'flat', delta: delta, mins: gap };
      return { dir: delta > 0 ? 'up' : 'down', delta: delta, mins: gap };
    }
    return null;
  }

  // ---- Rendering --------------------------------------------------------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function severity(c) {
    if (c === null || c === undefined) return 'unknown';
    if (c < 2) return 'clear';
    if (c < 4) return 'light';
    if (c < 6) return 'moderate';
    if (c < 8) return 'heavy';
    return 'severe';
  }

  function renderVerdict(ranked) {
    var box = $('verdict');
    box.innerHTML = '';
    var win = ranked[0];
    var lose = ranked[1];
    var margin = lose.penalty - win.penalty;
    var tossup = margin < TOSSUP_MARGIN;

    box.className = 'verdict sev-' + severity(win.reading.congestion);

    box.appendChild(el('p', 'verdict-kicker',
      tossup ? 'Not much in it' : 'Recommended'));
    box.appendChild(el('p', 'verdict-name', win.cp.name));
    box.appendChild(el('p', 'verdict-sub', 'via the ' + win.cp.crossing));

    var reason = el('p', 'verdict-reason');
    var wc = severity(win.reading.congestion);
    var lc = severity(lose.reading.congestion);
    var bits = [];
    if (wc === lc) {
      bits.push('Both look ' + wc + ' right now');
    } else {
      bits.push(win.cp.short + ' looks ' + wc + ', ' + lose.cp.short + ' looks ' + lc);
    }
    if (state.origin && state.dest) {
      var dm = Math.round(lose.travel.total - win.travel.total);
      if (Math.abs(dm) >= 3) {
        bits.push(
          dm > 0
            ? win.cp.short + ' is also about ' + Math.abs(dm) + ' min less driving'
            : 'though ' + win.cp.short + ' is about ' + Math.abs(dm) + ' min more driving'
        );
      }
    }
    reason.textContent = bits.join('; ') + '.';
    box.appendChild(reason);

    if (win.reading.usedPattern || lose.reading.usedPattern) {
      box.appendChild(el('p', 'verdict-flag',
        'Cameras unclear — this is based on what these crossings are typically like at this time, not on what they look like now.'));
    }

    if (tossup) {
      box.appendChild(el('p', 'verdict-flag',
        'The two are close enough that either is a reasonable choice.'));
    }
  }

  function renderCard(s) {
    var card = el('article', 'card sev-' + severity(s.reading.congestion));

    var head = el('header', 'card-head');
    head.appendChild(el('h2', null, s.cp.short));
    var score = el('span', 'score',
      s.reading.congestion === null ? '—' : s.reading.congestion.toFixed(1));
    head.appendChild(score);
    card.appendChild(head);

    var meta = el('p', 'card-meta');
    meta.appendChild(el('span', 'chip chip-' + severity(s.reading.congestion),
      severity(s.reading.congestion)));

    var t = trendFor(s.key);
    if (t && !s.reading.usedPattern) {
      var arrow = t.dir === 'up' ? '↑ building' : t.dir === 'down' ? '↓ clearing' : '→ steady';
      meta.appendChild(el('span', 'chip chip-trend trend-' + t.dir,
        arrow + ' (' + Math.round(t.mins) + ' min)'));
    }
    if (s.reading.usedPattern) {
      meta.appendChild(el('span', 'chip chip-pattern', 'typical for now'));
    } else {
      meta.appendChild(el('span', 'chip chip-conf',
        'confidence ' + Math.round(s.reading.confidence * 100) + '%'));
    }
    card.appendChild(meta);

    if (state.origin || state.dest) {
      var parts = [];
      if (state.origin) parts.push(Math.round(s.travel.toCp) + ' min to reach');
      if (state.dest) parts.push(Math.round(s.travel.onward) + ' min onward');
      card.appendChild(el('p', 'card-travel', parts.join(' · ') + ' (est. driving)'));
    }

    var shots = el('div', 'shots');
    (s.cp.cameras || []).forEach(function (cam) {
      if (!cam.image) return;
      var fig = el('figure', 'shot');
      var img = document.createElement('img');
      img.src = cam.image;
      img.alt = s.cp.short + ' camera ' + cam.id + ' (' + cam.role.replace('_', ' ') + ')';
      img.loading = 'lazy';
      // A still that will not load should collapse quietly rather than leave a
      // broken box under a verdict that is otherwise fine.
      img.addEventListener('error', function () { fig.classList.add('shot-missing'); });
      fig.appendChild(img);
      var cap = el('figcaption', null, cam.role.replace('_', ' '));
      if (cam.note) cap.title = cam.note;
      fig.appendChild(cap);
      shots.appendChild(fig);
    });
    card.appendChild(shots);

    return card;
  }

  function renderStatus() {
    var box = $('status');
    box.innerHTML = '';
    var d = state.data;
    if (!d) return;

    var age = minutesSince(d.source_timestamp);
    box.appendChild(el('span', null, 'Cameras ' + ago(age) + '.'));

    var ends = d.session && d.session.ends_at;
    if (ends && new Date(ends).getTime() < Date.now()) {
      box.appendChild(el('span', 'stale',
        ' Session ended — nothing is updating. Ask Claude to start another, or run the ' +
        '"Analyse checkpoints" workflow in the repo.'));
    } else if (ends) {
      var left = Math.max(0, (new Date(ends).getTime() - Date.now()) / 60000);
      box.appendChild(el('span', null,
        ' Updating every ' + d.session.interval_minutes + ' min for another ' +
        Math.round(left) + ' min.'));
    }

    if (d.degraded) {
      box.appendChild(el('span', 'stale', ' Last analysis failed (' + d.degraded + ').'));
    }
  }

  function render() {
    if (!state.data) return;
    var ranked = Object.keys(state.data.checkpoints)
      .map(function (k) { return score(k, state.data.checkpoints[k]); })
      .sort(function (a, b) { return a.penalty - b.penalty; });

    renderVerdict(ranked);

    var cards = $('cards');
    cards.innerHTML = '';
    ranked.forEach(function (s) { cards.appendChild(renderCard(s)); });

    renderStatus();
  }

  // ---- Wiring -----------------------------------------------------------

  function loadData() {
    // raw.githubusercontent caches for 300s, which would stack with the 5-minute
    // publish interval; the minute-stamped query keeps it honest.
    var bust = Math.floor(Date.now() / 60000);
    return fetch(DATA_URL + '?t=' + bust)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) { state.data = d; render(); })
      .catch(function (e) {
        $('verdict').innerHTML = '';
        $('verdict').appendChild(el('p', 'loading',
          'No analysis published yet (' + e.message + '). Start a session and this will fill in.'));
      });
  }

  function restoreTrip() {
    try {
      var saved = JSON.parse(localStorage.getItem('trip') || 'null');
      if (!saved) return;
      $('origin').value = saved.originQ || '';
      $('dest').value = saved.destQ || '';
      state.origin = saved.origin || null;
      state.dest = saved.dest || null;
    } catch (e) { /* ignore */ }
  }

  function saveTrip() {
    try {
      localStorage.setItem('trip', JSON.stringify({
        originQ: $('origin').value,
        destQ: $('dest').value,
        origin: state.origin,
        dest: state.dest
      }));
    } catch (e) { /* ignore */ }
  }

  function submitTrip(ev) {
    ev.preventDefault();
    var status = $('geo-status');
    var oq = $('origin').value.trim();
    var dq = $('dest').value.trim();
    if (!oq && !dq) {
      state.origin = state.dest = null;
      status.textContent = '';
      saveTrip();
      render();
      return;
    }
    status.textContent = 'Looking up places…';
    $('go').disabled = true;

    // Sequential, not parallel: Nominatim asks for at most 1 request/second.
    geocode(oq)
      .then(function (o) {
        state.origin = oq ? o : null;
        return dq ? new Promise(function (res) { setTimeout(function () { res(geocode(dq)); }, 1100); }) : null;
      })
      .then(function (d) {
        state.dest = dq ? d : null;
        var missed = [];
        if (oq && !state.origin) missed.push('"' + oq + '"');
        if (dq && !state.dest) missed.push('"' + dq + '"');
        status.textContent = missed.length
          ? 'Could not find ' + missed.join(' or ') + '. Try a more specific name.'
          : [state.origin && state.origin.label.split(',')[0],
             state.dest && state.dest.label.split(',')[0]].filter(Boolean).join('  →  ');
        $('go').disabled = false;
        saveTrip();
        render();
      });
  }

  function init() {
    document.querySelectorAll('.dir-toggle button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.direction = b.dataset.dir;
        document.querySelectorAll('.dir-toggle button').forEach(function (o) {
          o.classList.toggle('on', o === b);
          o.setAttribute('aria-pressed', String(o === b));
        });
        render();
      });
    });
    $('trip').addEventListener('submit', submitTrip);
    restoreTrip();
    loadData();
    // Cameras refresh every 5 minutes; re-check a little more often than that.
    setInterval(loadData, 150000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// Booqable time-slot helper — fetches the shop's business hours + time
// increment so the PDP and cart can offer the same valid time slots that
// Booqable's own hosted shop uses. Expects a global BOOQABLE_KEY set before
// this script runs.
//
// Booqable's model (as of 2026): one or more `operating_rules` of
// `data_type=hours` per weekday key (mon-sat, sun, or `weekday` for Mon-Fri).
// We collapse them into per-day open windows and slice each window into
// `time_increment`-minute steps.

(function (global) {
  const SETTINGS_URL = `https://byfernstudio.booqable.com/api/4/settings/current`;
  const RULES_URL    = `https://byfernstudio.booqable.com/api/boomerang/operating_rules`;
  const WEEKDAY_KEYS = ['mon','tue','wed','thu','fri'];
  const DAY_LIST     = ['sun','mon','tue','wed','thu','fri','sat'];

  let cache = null;
  let loading = null;

  function dayKeyFromDate(dateStr) {
    return DAY_LIST[new Date(`${dateStr}T00:00:00`).getDay()];
  }

  function loadBooqableTimeConfig() {
    if (cache) return Promise.resolve(cache);
    if (loading) return loading;
    loading = (async () => {
      try {
        // BOOQABLE_KEY is declared as a top-level `const` in the page's first
        // <script>; classic-script scope makes it reachable here.
        const authHeaders = { 'Authorization': `Bearer ${BOOQABLE_KEY}` };
        const [settingsRes, rulesRes] = await Promise.all([
          fetch(SETTINGS_URL, { headers: authHeaders }),
          fetch(RULES_URL,    { headers: authHeaders }),
        ]);
        if (!settingsRes.ok || !rulesRes.ok) throw new Error('settings/rules fetch failed');
        const settings = (await settingsRes.json()).data.attributes;
        const store    = settings.store  || {};
        const orders   = settings.orders || {};
        const rules    = (await rulesRes.json()).data
          .filter(r => r.attributes.data_type === 'hours')
          .map(r => r.attributes.data);
        cache = {
          increment:        store.time_increment || 60,
          useBusinessHours: store.use_business_hours !== false,
          useTimes:         store.use_times !== false,
          defaultStart:     orders.start_fixed_at || '10:00',
          defaultStop:      orders.stop_fixed_at  || '18:00',
          rules,
        };
      } catch (e) {
        cache = {
          increment:        60,
          useBusinessHours: false,
          useTimes:         true,
          defaultStart:     '10:00',
          defaultStop:      '18:00',
          rules:            [],
        };
      }
      return cache;
    })();
    return loading;
  }

  function toMin(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  // Build the list of valid HH:MM slots for a YYYY-MM-DD date based on the
  // shop's open hours and time_increment. Returns [] if the shop is closed
  // on that day or if business hours are disabled (caller can fall back).
  //
  // opts.extendTill = "HH:MM" — extend the latest open window's end time
  // to this value if it's later. Used for return-time selects where the
  // shop accepts after-hours drop-offs.
  function getValidTimeSlots(dateStr, opts) {
    opts = opts || {};
    if (!cache || !dateStr) return [];
    if (!cache.useBusinessHours) return [];
    const day = dayKeyFromDate(dateStr);
    const isWeekday = WEEKDAY_KEYS.includes(day);
    const windows = cache.rules
      .map(r => r[day] || (isWeekday ? r.weekday : null))
      .filter(Boolean)
      .map(w => ({ from: w.from, till: w.till }));

    if (opts.extendTill && windows.length) {
      let latest = windows[0];
      for (const w of windows) if (toMin(w.till) > toMin(latest.till)) latest = w;
      if (toMin(opts.extendTill) > toMin(latest.till)) latest.till = opts.extendTill;
    }

    const inc = cache.increment;
    const seen = new Set();
    const slots = [];
    for (const win of windows) {
      let mins = toMin(win.from);
      const tillMins = toMin(win.till);
      while (mins <= tillMins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const s = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        if (!seen.has(s)) { seen.add(s); slots.push(s); }
        mins += inc;
      }
    }
    return slots.sort();
  }

  function formatTimeLabel(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const am = h < 12;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2,'0')} ${am ? 'AM' : 'PM'}`;
  }

  // Pick the slot closest to `preferred` (HH:MM) from `slots`. Falls back to
  // the first slot if nothing's close.
  function nearestSlot(slots, preferred) {
    if (!slots.length) return '';
    if (!preferred) return slots[0];
    const target = (() => { const [h,m] = preferred.split(':').map(Number); return h*60 + m; })();
    let best = slots[0]; let bestDiff = Infinity;
    for (const s of slots) {
      const [h,m] = s.split(':').map(Number);
      const diff = Math.abs((h*60+m) - target);
      if (diff < bestDiff) { bestDiff = diff; best = s; }
    }
    return best;
  }

  // Replace a <select>'s options with the valid slots for `dateStr`,
  // preserving the user's chosen value when possible. Returns the value
  // the select ended up with (so callers can persist it).
  //
  // opts is forwarded to getValidTimeSlots — see its docs for extendTill.
  function populateTimeSelect(selectEl, dateStr, preferredValue, opts) {
    if (!selectEl) return '';
    const slots = getValidTimeSlots(dateStr, opts);
    if (!slots.length) {
      selectEl.innerHTML = `<option value="">${dateStr ? 'Closed on this day' : 'Pick a date'}</option>`;
      selectEl.disabled = true;
      return '';
    }
    const chosen = slots.includes(preferredValue) ? preferredValue : nearestSlot(slots, preferredValue);
    selectEl.disabled = false;
    selectEl.innerHTML = slots
      .map(s => `<option value="${s}"${s === chosen ? ' selected' : ''}>${formatTimeLabel(s)}</option>`)
      .join('');
    return chosen;
  }

  global.BooqableTimes = {
    load:             loadBooqableTimeConfig,
    getValidSlots:    getValidTimeSlots,
    populateSelect:   populateTimeSelect,
    formatLabel:      formatTimeLabel,
    nearest:          nearestSlot,
    config:           () => cache,
  };
})(window);

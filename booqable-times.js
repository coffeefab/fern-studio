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

  // ============================================================
  // Availabilities: the recommended endpoint for bookability checks.
  // Replaces the deprecated /api/4/inventory_levels for time-window
  // questions. Respects per-product buffer times and other business rules.
  // ============================================================

  const ITEMS_URL = `https://byfernstudio.booqable.com/api/boomerang/items?page%5Bsize%5D=200&fields%5Bitems%5D=name,product_group_id`;
  const itemIdByProductGroup = new Map();
  let itemMapLoading = null;

  function loadItemMap() {
    if (itemIdByProductGroup.size > 0) return Promise.resolve(itemIdByProductGroup);
    if (itemMapLoading) return itemMapLoading;
    itemMapLoading = (async () => {
      try {
        const res = await fetch(ITEMS_URL, {
          headers: {
            'Authorization': `Bearer ${BOOQABLE_KEY}`,
            'Accept':        'application/vnd.api+json',
          },
        });
        if (!res.ok) return itemIdByProductGroup;
        const { data } = await res.json();
        (data || []).forEach(it => {
          const pgId = it?.attributes?.product_group_id;
          if (pgId) itemIdByProductGroup.set(pgId, it.id);
        });
      } catch (e) {}
      return itemIdByProductGroup;
    })();
    return itemMapLoading;
  }

  // Check whether `productGroupId` is bookable from `dropoffHHMM` to `returnHHMM`
  // on the local `dateStr` (YYYY-MM-DD). If the return is before the dropoff we
  // roll it to the next day. Returns { status, records } where status is one of
  // 'available' | 'partial' | 'unavailable' | 'unknown'. 'unknown' covers the
  // cases where we don't have an item_id mapping or the API call failed.
  async function checkProductAvailability(productGroupId, dateStr, dropoffHHMM, returnHHMM) {
    if (!productGroupId || !dateStr || !dropoffHHMM || !returnHHMM) {
      return { status: 'unknown', records: [] };
    }
    await loadItemMap();
    const itemId = itemIdByProductGroup.get(productGroupId);
    if (!itemId) return { status: 'unknown', records: [] };

    const fromLocal = new Date(`${dateStr}T${dropoffHHMM}:00`);
    const tillLocal = new Date(`${dateStr}T${returnHHMM}:00`);
    if (tillLocal <= fromLocal) tillLocal.setDate(tillLocal.getDate() + 1);
    const durHours = Math.max(1, Math.ceil((tillLocal - fromLocal) / 3600000));

    const params = new URLSearchParams({
      'filter[subject_type]':     'item',
      'filter[subject_id]':       itemId,
      'filter[year]':             String(fromLocal.getFullYear()),
      'filter[month]':            String(fromLocal.getMonth() + 1),
      'filter[day]':              String(fromLocal.getDate()),
      'filter[starts_at]':        fromLocal.toISOString(),
      'filter[duration_period]':  `PT${durHours}H`,
    });

    try {
      const res = await fetch(
        `https://byfernstudio.booqable.com/api/4/availabilities?${params.toString()}`,
        { headers: { 'Authorization': `Bearer ${BOOQABLE_KEY}` } }
      );
      if (!res.ok) return { status: 'unknown', records: [] };
      const { data } = await res.json();
      const records = (data || []).map(r => r.attributes);
      if (!records.length) return { status: 'unknown', records };
      if (records.every(r => r.available === true))  return { status: 'available',   records };
      if (records.every(r => r.available === false)) return { status: 'unavailable', records };
      return { status: 'partial', records };
    } catch (e) {
      return { status: 'unknown', records: [] };
    }
  }

  // ============================================================
  // Shared schedule persistence: the date / dropoff / return the customer
  // last picked. The PDP and the shop cart both read and write here so a
  // date chosen on the product page shows up in the cart and vice versa.
  // ============================================================

  const SCHEDULE_KEY = 'fern_cart_times_v1'; // legacy key, kept for continuity
  const SCHEDULE_DEFAULTS = { date: '', dropoff: '10:00', ret: '18:00' };

  function loadSchedule() {
    try {
      const s = localStorage.getItem(SCHEDULE_KEY);
      const v = s ? JSON.parse(s) : null;
      return {
        date:    (v && typeof v.date    === 'string') ? v.date    : SCHEDULE_DEFAULTS.date,
        dropoff: (v && typeof v.dropoff === 'string') ? v.dropoff : SCHEDULE_DEFAULTS.dropoff,
        ret:     (v && typeof v.ret     === 'string') ? v.ret     : SCHEDULE_DEFAULTS.ret,
      };
    } catch (e) { return { ...SCHEDULE_DEFAULTS }; }
  }

  function saveSchedule(partial) {
    const next = { ...loadSchedule(), ...(partial || {}) };
    try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(next)); } catch (e) {}
  }

  global.BooqableTimes = {
    load:                       loadBooqableTimeConfig,
    getValidSlots:              getValidTimeSlots,
    populateSelect:             populateTimeSelect,
    formatLabel:                formatTimeLabel,
    nearest:                    nearestSlot,
    config:                     () => cache,
    loadItemMap:                loadItemMap,
    checkProductAvailability:   checkProductAvailability,
    loadSchedule:               loadSchedule,
    saveSchedule:               saveSchedule,
  };
})(window);

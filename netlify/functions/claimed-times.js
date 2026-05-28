// Returns the pickup / return times already claimed by other Booqable orders
// on the given date, so the PDP and cart can hide them from the time selects.
// One person handles deliveries, so each starts_at and stops_at of every
// order on the date is a slot the driver is already booked for.
//
// Lives server-side because reading orders requires the full Booqable admin
// key (BOOQABLE_API_KEY), which we do NOT expose in browser code. The
// response is intentionally minimal — only the ISO timestamps — so customer
// PII (names, addresses, totals) never reaches the client.
//
// GET /api/claimed-times?date=YYYY-MM-DD
// → { items: [{ starts_at: ISO, stops_at: ISO }, ...], date }

exports.handler = async (event) => {
  const CORS = {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Cache-Control':                'no-store',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const { date } = event.queryStringParameters || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Pass ?date=YYYY-MM-DD' }) };
  }

  const apiKey = process.env.BOOQABLE_API_KEY;
  const host   = process.env.BOOQABLE_COMPANY || 'byfernstudio';
  if (!apiKey) {
    // Fail open: no key, no blocks — better than blocking the whole shop.
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: [], _no_key: true }) };
  }

  // Wide UTC window — 24h before/after the target date in UTC — so any
  // timezone-shifted order touching the customer's local date still comes
  // back. The frontend pins to the local date when converting.
  const day0    = new Date(`${date}T00:00:00Z`);
  const fromDt  = new Date(day0); fromDt.setUTCDate(fromDt.getUTCDate() - 1);
  const tillDt  = new Date(day0); tillDt.setUTCDate(tillDt.getUTCDate() + 2);
  const fromISO = fromDt.toISOString();
  const tillISO = tillDt.toISOString();

  async function queryOrders(filterField) {
    const params = new URLSearchParams();
    params.set(`filter[${filterField}][gte]`, fromISO);
    params.set(`filter[${filterField}][lte]`, tillISO);
    params.set('per_page', '100');
    const url = `https://${host}.booqable.com/api/4/orders?${params}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = await res.json();
    // /api/4 returns { orders: [...] }; boomerang returns { data: [...] }.
    return json.orders || json.data || [];
  }

  try {
    const [byStart, byStop] = await Promise.all([
      queryOrders('starts_at'),
      queryOrders('stops_at'),
    ]);
    const seen  = new Set();
    const items = [];
    for (const o of [...byStart, ...byStop]) {
      const id = o.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const a = o.attributes || o;
      items.push({
        starts_at: a.starts_at || null,
        stops_at:  a.stops_at  || null,
      });
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items, date }) };
  } catch (err) {
    // Fail open — surface the error in the body for debugging but don't
    // block bookings if our lookup misbehaves.
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ items: [], _err: String(err && err.message || err) }) };
  }
};

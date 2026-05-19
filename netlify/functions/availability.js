// Proxies Booqable availability API — keeps your API key server-side only.
// Deployed to /.netlify/functions/availability, reachable at /api/availability

const BOOQABLE_BASE = `https://${process.env.BOOQABLE_COMPANY || 'byfernstudio'}.booqable.com/api/4`;

// Map each website category to its Booqable product group ID.
// Set these in Netlify → Site settings → Environment variables.
// Run /api/products first to discover your product IDs.
const PRODUCT_IDS = {
  flower_wall:  process.env.BOOQABLE_FLOWER_WALL_ID,
  floral_arch:  process.env.BOOQABLE_ARCH_ID,
  floral_frame: process.env.BOOQABLE_FRAME_ID,
  tables:       process.env.BOOQABLE_TABLES_ID,
  drapery:      process.env.BOOQABLE_DRAPERY_ID,
};

async function checkProduct(productId, year, month, day) {
  const params = new URLSearchParams({
    'filter[subject_type]': 'product_group',
    'filter[subject_id]':   productId,
    'filter[year]':         String(year),
    'filter[month]':        String(month),
    'filter[day]':          String(day),
  });

  const res = await fetch(`${BOOQABLE_BASE}/availabilities?${params}`, {
    headers: {
      Authorization: `Bearer ${process.env.BOOQABLE_API_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    console.error(`Booqable error for product ${productId}: ${res.status}`);
    return 'available'; // fail open — don't block the user
  }

  const json = await res.json();
  const target = String(day).padStart(2, '0');
  const entry = json.data?.find(d => d.attributes?.date?.endsWith(`-${target}`));

  // Booqable statuses: 'available' | 'partial' | 'unavailable'
  return entry?.attributes?.status ?? 'available';
}

exports.handler = async (event) => {
  const CORS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const { date } = event.queryStringParameters || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Pass ?date=YYYY-MM-DD' }) };
  }

  const [year, month, day] = date.split('-').map(Number);

  try {
    const configured = Object.entries(PRODUCT_IDS).filter(([, id]) => id);

    if (configured.length === 0) {
      // No IDs set yet — return mock data so the site still works during setup
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          flower_wall: 'available', floral_arch: 'available',
          floral_frame: 'available', tables: 'available', drapery: 'available',
          overall: 'available', date, _mock: true,
        }),
      };
    }

    const results = {};
    await Promise.all(
      configured.map(async ([key, id]) => {
        results[key] = await checkProduct(id, year, month, day);
      })
    );

    // Fill any unconfigured categories as available
    for (const key of Object.keys(PRODUCT_IDS)) {
      if (!(key in results)) results[key] = 'available';
    }

    // Overall = worst single status
    const statuses = Object.values(results);
    const overall = statuses.includes('unavailable') ? 'unavailable'
      : statuses.includes('partial') ? 'partial'
      : 'available';

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ ...results, overall, date }),
    };
  } catch (err) {
    console.error('Availability check failed:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Check failed' }) };
  }
};

// Helper endpoint — call this once to discover your Booqable product group IDs.
// Visit: https://ferneventrentals.com/api/products
// Copy the IDs into Netlify env vars, then you won't need this endpoint again.

const BOOQABLE_BASE = `https://${process.env.BOOQABLE_COMPANY || 'byfernstudio'}.booqable.com/api/4`;

exports.handler = async () => {
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const res = await fetch(`${BOOQABLE_BASE}/product_groups?page[size]=100`, {
      headers: {
        Authorization: `Bearer ${process.env.BOOQABLE_API_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: `Booqable returned ${res.status}` }) };
    }

    const json = await res.json();
    const products = (json.data || []).map(p => ({
      id:            p.id,
      name:          p.attributes.name,
      slug:          p.attributes.slug,
      tracking_type: p.attributes.tracking_type, // 'bulk' or 'trackable'
      show_in_store: p.attributes.show_in_store,
    }));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        products,
        hint: 'Copy each product id into the matching Netlify env var (BOOQABLE_FLOWER_WALL_ID, etc.)',
        env_vars_needed: [
          'BOOQABLE_FLOWER_WALL_ID',
          'BOOQABLE_ARCH_ID',
          'BOOQABLE_FRAME_ID',
          'BOOQABLE_TABLES_ID',
          'BOOQABLE_DRAPERY_ID',
        ],
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: String(err) }) };
  }
};

// Sends booking modal submissions to byfernstudio@gmail.com via Resend.
// Deployed to /.netlify/functions/send-booking, reachable at /api/send-booking
//
// Required env vars (Netlify → Site settings → Environment variables):
//   RESEND_API_KEY   — get from https://resend.com (free 100/day)
//   FROM_EMAIL       — verified sender on Resend (e.g. bookings@ferneventrentals.com)
//                      or "onboarding@resend.dev" while testing
// Optional:
//   TO_EMAIL         — defaults to byfernstudio@gmail.com

const TO_EMAIL_DEFAULT = 'byfernstudio@gmail.com';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: 'Email service not configured (missing RESEND_API_KEY)' };
  }

  const FROM = process.env.FROM_EMAIL || 'onboarding@resend.dev';
  const TO   = process.env.TO_EMAIL   || TO_EMAIL_DEFAULT;

  const fullAddress = [
    data.addr1,
    data.addr2,
    [data.city, data.state, data.zip].filter(Boolean).join(', '),
  ].filter(Boolean).join('\n');

  const fields = [
    ['Name',              data.name],
    ['Email',             data.email],
    ['Phone',             data.phone],
    ['Event date',        data.date],
    ['Event type',        data.eventType || '(not specified)'],
    ['Address',           fullAddress || '(not provided)'],
    ['Delivery',          data.delivery === 'yes' ? 'Yes ($40)' : 'No, picking up'],
    ['Drop off / pickup', data.dropoff],
    ['Return',            data.return],
    ['Items requested',   data.items],
    ['Notes',             data.notes || '(none)'],
  ];

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1C1B14;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="color:#383410;margin:0 0 16px;font-family:Georgia,serif">New booking request</h2>
      <p style="color:#6B6358;margin:0 0 20px;font-size:14px">A new inquiry came in from ferneventrentals.com.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${fields.map(([k, v]) => `
          <tr>
            <td style="padding:10px 12px 10px 0;color:#6B6358;vertical-align:top;width:160px;border-bottom:1px solid #EDE8DF"><strong>${escapeHtml(k)}</strong></td>
            <td style="padding:10px 0;color:#1C1B14;white-space:pre-wrap;border-bottom:1px solid #EDE8DF">${escapeHtml(v)}</td>
          </tr>
        `).join('')}
      </table>
      <p style="margin-top:24px;font-size:12px;color:#B0A898">Reply directly to this email to reach ${escapeHtml(data.name || 'the customer')}.</p>
    </div>
  `;

  const text = fields.map(([k, v]) => `${k}: ${v || ''}`).join('\n');

  const subject = `New booking · ${data.name || 'unknown'} · ${data.date || 'no date'}`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     FROM,
        to:       [TO],
        reply_to: data.email || undefined,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, body: `Email send failed: ${errText}` };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (e) {
    return { statusCode: 500, body: 'Unable to send email right now.' };
  }
};

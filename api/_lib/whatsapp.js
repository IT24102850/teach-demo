/**
 * Sending to WhatsApp.
 *
 * If WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set, the message goes out
 * through the WhatsApp Business Cloud API from the server. If they are not,
 * the call does not fail: it returns a wa.me link so the teacher's own
 * WhatsApp opens with the text ready to send. Either way an event row records
 * what happened, so nothing is silently lost.
 *
 * Note on Meta's rules: a business-started conversation outside the 24 hour
 * customer service window must use an approved template. Set
 * WHATSAPP_TEMPLATE_* to the names of your approved templates once you have
 * them; until then the free-text path only works as a reply, and the wa.me
 * fallback covers the rest.
 */

const TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_ID = process.env.WHATSAPP_PHONE_ID || '';
const GRAPH = process.env.WHATSAPP_API_VERSION || 'v21.0';

export const whatsappReady = Boolean(TOKEN && PHONE_ID);

/** Keep only digits; Sri Lankan numbers are stored as 947XXXXXXXX. */
export const normalisePhone = (phone) => String(phone || '').replace(/[^\d]/g, '');

export function waLink(phone, text) {
  return `https://wa.me/${normalisePhone(phone)}?text=${encodeURIComponent(text)}`;
}

/**
 * @returns {Promise<{status:'sent'|'manual'|'failed', link?:string, error?:string}>}
 */
export async function sendWhatsApp(phone, text) {
  const to = normalisePhone(phone);
  if (!to) return { status: 'failed', error: 'No phone number on file' };
  if (!whatsappReady) return { status: 'manual', link: waLink(to, text) };

  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: true, body: text },
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error('[whatsapp]', res.status, detail);
      return { status: 'failed', error: `WhatsApp API ${res.status}`, link: waLink(to, text) };
    }
    return { status: 'sent' };
  } catch (err) {
    console.error('[whatsapp]', err);
    return { status: 'failed', error: err.message, link: waLink(to, text) };
  }
}

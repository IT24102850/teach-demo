/**
 * Email, through Resend (https://resend.com): today only the teacher's
 * password-reset link.
 *
 *   RESEND_API_KEY  re_...                  from the Resend dashboard
 *   EMAIL_FROM      Plus <no-reply@your-domain>  a sender on a domain verified in Resend
 *
 * Without both, nothing is sent and `sendEmail` answers { status: 'disabled' }.
 * The reset endpoint still answers the same way either way - it never tells
 * the person asking whether an account exists - and the owner sees the
 * failure in the function logs.
 */

const KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || '';

export const emailReady = Boolean(KEY && FROM);

/** Escape a value for the HTML body. */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function sendEmail({ to, subject, text, html }) {
  if (!emailReady) return { status: 'disabled' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    });
    if (!res.ok) {
      console.error('[email]', res.status, (await res.text()).slice(0, 300));
      return { status: 'failed' };
    }
    return { status: 'sent' };
  } catch (err) {
    console.error('[email]', err?.message);
    return { status: 'failed' };
  }
}

/*
 * The reset email, in the teacher's language. Short, with the link on its
 * own line, and saying plainly what to do if they did not ask for it.
 */
const RESET = {
  en: {
    subject: 'Reset your Plus password',
    hello: (name) => `Hi ${name},`,
    body: (minutes) => `Someone asked to reset the password for your Plus account. The link works once, for ${minutes} minutes:`,
    button: 'Choose a new password',
    ignore: 'If this was not you, ignore this email. Your password stays the same.',
  },
  si: {
    subject: 'ඔබේ Plus මුරපදය යළි සකසන්න',
    hello: (name) => `ආයුබෝවන් ${name},`,
    body: (minutes) => `ඔබේ Plus ගිණුමේ මුරපදය යළි සැකසීමට ඉල්ලීමක් ලැබුණා. මෙම සබැඳිය එක් වරක්, විනාඩි ${minutes} ක් සඳහා ක්‍රියා කරයි:`,
    button: 'නව මුරපදයක් තෝරන්න',
    ignore: 'මෙය ඔබ නොවේ නම් මෙම ඊමේල් පණිවිඩය නොසලකා හරින්න. ඔබේ මුරපදය වෙනස් නොවේ.',
  },
  ta: {
    subject: 'உங்கள் Plus கடவுச்சொல்லை மீட்டமைக்கவும்',
    hello: (name) => `வணக்கம் ${name},`,
    body: (minutes) => `உங்கள் Plus கணக்கின் கடவுச்சொல்லை மீட்டமைக்க ஒரு கோரிக்கை வந்தது. இந்த இணைப்பு ஒருமுறை, ${minutes} நிமிடங்களுக்கு மட்டுமே வேலை செய்யும்:`,
    button: 'புதிய கடவுச்சொல்லைத் தேர்வு செய்யவும்',
    ignore: 'இது நீங்கள் இல்லையென்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கவும். உங்கள் கடவுச்சொல் மாறாது.',
  },
};

export function resetEmail({ name, link, minutes, lang = 'en' }) {
  const w = RESET[lang] || RESET.en;
  const text = `${w.hello(name)}\n\n${w.body(minutes)}\n\n${link}\n\n${w.ignore}\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#eef4f5;font-family:Arial,Helvetica,sans-serif;color:#0c1a1c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:16px" cellpadding="0" cellspacing="0"><tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:22px;font-weight:800;color:#00747a">PLUS</p>
<p style="margin:16px 0 8px;font-size:15px">${esc(w.hello(name))}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${esc(w.body(minutes))}</p>
<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#00c2cb;color:#04191b;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:24px">${esc(w.button)}</a></p>
<p style="margin:0 0 6px;font-size:12px;color:#566b6f;word-break:break-all">${esc(link)}</p>
<p style="margin:16px 0 0;font-size:13px;color:#566b6f">${esc(w.ignore)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: w.subject, text, html };
}

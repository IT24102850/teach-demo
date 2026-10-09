/**
 * Point 1: the web fonts must never hold up the first paint.
 *
 * index.html no longer links the Google stylesheet, so the browser paints as
 * soon as style.css arrives, using the system font. This module attaches the
 * font stylesheet afterwards; `display=swap` then swaps the text over when the
 * files land. If Google is slow or blocked the app simply stays on the system
 * font - it never shows a blank screen.
 *
 * The <link> is created here rather than with an inline onload handler because
 * the Content-Security-Policy in vercel.json allows `script-src 'self'` only.
 */

const HREF =
  'https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@500;700;800' +
  '&family=Noto+Sans+Tamil:wght@500;700;800&display=swap';

export function loadFonts() {
  if (document.querySelector('link[data-fonts]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = HREF;
  link.dataset.fonts = '1';
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

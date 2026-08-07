/**
 * Branded HTML email layout — ported verbatim from scheme.cred2tech.com's
 * backend (`nestjs-backend/src/mail/email-template.ts`, `renderBrandedEmail`)
 * so every email sent by this app matches that one exactly: same company,
 * same look. Do not restyle independently — if the sibling app's template
 * changes, port the change here too rather than drifting.
 *
 * Design language: SHARP edges (no border-radius), the app's indigo/emerald
 * palette, the Hikasami brand font (with web-safe fallbacks, since custom
 * fonts rarely load in email clients), and a table-based structure for
 * maximum email-client compatibility (Gmail, Outlook, Apple Mail).
 */

// ── Brand palette (mirrors the frontend tokens — keep in sync with the sibling app) ─
const C = {
  bg: '#eef4ff', // app background
  card: '#ffffff',
  ink: '#0f1b2d', // primary text
  body: '#33425a', // body text
  muted: '#64748b',
  faint: '#94a3b8',
  primary: '#4f46e5', // indigo
  primaryDark: '#3730a3',
  emerald: '#059669',
  line: '#e2e8f6',
  panel: '#f6f8ff',
};

const FONT = "'Hikasami','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// The live site's own white wordmark — used in every email header instead of
// a plain-text "CRED2TECH" span so emails visually match cred2tech.com.
// `opts.logoUrl` can still override this per-call if ever needed.
const DEFAULT_LOGO_URL = 'https://www.cred2tech.com/_next/image?url=%2Flogos%2Fwhite-logo.png&w=384&q=75';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the branded HTML + a plain-text fallback for an email.
 * @param {{
 *   title: string,
 *   preheader?: string,
 *   heading: string,
 *   intro?: string,
 *   paragraphs?: string[],
 *   button?: { label: string, url: string },
 *   highlight?: { label: string, value: string, mono?: boolean },
 *   customBody?: string,
 *   note?: string,
 *   logoUrl?: string,
 *   appUrl?: string,
 * }} opts
 * @returns {{ html: string, text: string }}
 */
function renderBrandedEmail(opts) {
  const year = new Date().getFullYear();
  // Deliberately NOT FRONTEND_URL (that's this app's own domain, e.g.
  // app.cred2tech.com or localhost) — the footer always points at the
  // public marketing site unless a caller explicitly overrides it.
  const appUrl = opts.appUrl || 'https://cred2tech.com';

  const logoUrl = opts.logoUrl || DEFAULT_LOGO_URL;
  const logoBlock = `<img src="${esc(logoUrl)}" alt="Cred2Tech" height="28" style="display:block;border:0;height:28px;" />`;

  const intro = opts.intro
    ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.ink};font-weight:600;">${esc(opts.intro)}</p>`
    : '';

  const paragraphs = (opts.paragraphs || [])
    .map(
      (p) =>
        `<p style="margin:0 0 14px;font-family:${FONT};font-size:14px;line-height:1.65;color:${C.body};">${esc(p)}</p>`,
    )
    .join('');

  const highlight = opts.highlight
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;">
        <tr><td style="background:${C.panel};border:1px solid ${C.line};border-left:3px solid ${C.primary};padding:14px 16px;">
          <p style="margin:0 0 4px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:${C.faint};">${esc(opts.highlight.label)}</p>
          <p style="margin:0;font-family:${opts.highlight.mono ? "'SFMono-Regular',Menlo,Consolas,monospace" : FONT};font-size:${opts.highlight.mono ? '20px' : '16px'};font-weight:700;letter-spacing:${opts.highlight.mono ? '1px' : '0'};color:${C.ink};word-break:break-all;">${esc(opts.highlight.value)}</p>
        </td></tr>
      </table>`
    : '';

  const button = opts.button
    ? `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
        <tr><td style="background:${C.primary};">
          <a href="${esc(opts.button.url)}" target="_blank"
             style="display:inline-block;padding:12px 26px;font-family:${FONT};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.3px;">
            ${esc(opts.button.label)}
          </a>
        </td></tr>
      </table>`
    : '';

  const note = opts.note
    ? `<p style="margin:14px 0 0;padding-top:14px;border-top:1px solid ${C.line};font-family:${FONT};font-size:12px;line-height:1.6;color:${C.muted};">${esc(opts.note)}</p>`
    : '';

  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${esc(opts.preheader)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${C.card};border:1px solid ${C.line};">
        <!-- Header -->
        <tr><td style="background:${C.primary};padding:20px 28px;border-bottom:3px solid ${C.emerald};">
          ${logoBlock}
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:30px 28px 26px;">
          <h1 style="margin:0 0 16px;font-family:${FONT};font-size:20px;line-height:1.3;font-weight:800;color:${C.ink};">${esc(opts.heading)}</h1>
          ${intro}
          ${paragraphs}
          ${highlight}
          ${button}
          ${opts.customBody ?? ''}
          ${note}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 28px;background:${C.panel};border-top:1px solid ${C.line};">
          <p style="margin:0 0 4px;font-family:${FONT};font-size:12px;font-weight:700;color:${C.ink};">Cred2Tech</p>
          <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.muted};">
            Multi-Lender Eligibility. Minutes Away.
          </p>
          <p style="margin:0;font-family:${FONT};font-size:11px;color:${C.faint};">
            <a href="${esc(appUrl)}" target="_blank" style="color:${C.primary};text-decoration:none;">${esc(appUrl.replace(/^https?:\/\//, ''))}</a>
            &nbsp;·&nbsp; &copy; ${year} Cred2Tech. All rights reserved.
          </p>
          <p style="margin:8px 0 0;font-family:${FONT};font-size:10px;color:${C.faint};">
            This is an automated message — please do not reply directly to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Plain-text fallback
  const text = [
    opts.heading,
    '',
    opts.intro || '',
    ...(opts.paragraphs || []),
    opts.highlight ? `\n${opts.highlight.label}: ${opts.highlight.value}` : '',
    opts.button ? `\n${opts.button.label}: ${opts.button.url}` : '',
    opts.note ? `\n${opts.note}` : '',
    '',
    '— Cred2Tech',
    appUrl,
  ]
    .filter((l) => l !== undefined && l !== '')
    .join('\n');

  return { html, text };
}

module.exports = { renderBrandedEmail, esc, BRAND_COLORS: C, BRAND_FONT: FONT };

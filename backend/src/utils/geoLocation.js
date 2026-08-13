// geoLocation.js
// Best-effort IP → city/region/country lookup for security-alert emails
// (new trusted device / new MFA method). Never throws — a lookup failure
// just means the email says "Unknown location" instead of blocking the
// email (or whatever triggered it) entirely.

const axios = require('axios');

const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc00:|fe80:)/i;

function isPrivateOrLocalIp(ip) {
  if (!ip) return true;
  return PRIVATE_IP_RE.test(ip) || ip === 'unknown';
}

/**
 * @param {string} ip
 * @returns {Promise<{ city: string, region: string, country: string, label: string } | null>}
 */
async function resolveIpLocation(ip) {
  if (isPrivateOrLocalIp(ip)) return null;
  try {
    const { data } = await axios.get(`https://ipwho.is/${encodeURIComponent(ip)}`, { timeout: 3000 });
    if (!data || data.success === false) return null;
    const { city, region, country } = data;
    const parts = [city, region, country].filter(Boolean);
    if (parts.length === 0) return null;
    return { city, region, country, label: parts.join(', ') };
  } catch (err) {
    console.warn('[geoLocation] IP lookup failed:', err.message);
    return null;
  }
}

module.exports = { resolveIpLocation, isPrivateOrLocalIp };

/**
 * Shared SSRF-prevention helpers for every place this backend fetches a
 * server-controlled or vendor-supplied URL (Signzy report downloads, GST/bank
 * webhook JSON fetches, etc). A URL that merely *looks* public can still
 * resolve to an internal/loopback/link-local address (DNS rebinding), so
 * validation happens against the resolved IP, not just the hostname string —
 * and the same resolved IP is pinned for the actual connection so a second,
 * different DNS answer can't be substituted between check and connect.
 */

const axios = require('axios');
const dns = require('dns');
const net = require('net');

// Vendor domains this backend is expected to fetch from. Unlike the previous
// per-service allowlist, this one is a hard block, not a warn-only check.
const ALLOWED_VENDOR_DOMAINS = [
    'signzy.tech',
    'signzy.app',
    'signzy.com',
    's3.amazonaws.com',
    's3.ap-south-1.amazonaws.com',
    'amazonaws.com',
];

function isPrivateOrReservedIp(ip) {
    const version = net.isIP(ip);
    if (version === 4) {
        const octets = ip.split('.').map(Number);
        const [a, b] = octets;
        if (a === 10) return true;                                   // 10.0.0.0/8
        if (a === 172 && b >= 16 && b <= 31) return true;              // 172.16.0.0/12
        if (a === 192 && b === 168) return true;                      // 192.168.0.0/16
        if (a === 127) return true;                                   // 127.0.0.0/8 loopback
        if (a === 169 && b === 254) return true;                      // 169.254.0.0/16 link-local (incl. cloud metadata)
        if (a === 0) return true;                                     // 0.0.0.0/8
        if (a === 100 && b >= 64 && b <= 127) return true;             // 100.64.0.0/10 CGNAT
        if (a === 192 && b === 0 && octets[2] === 2) return true;      // 192.0.2.0/24 TEST-NET
        if (a === 198 && (b === 18 || b === 19)) return true;          // 198.18.0.0/15 benchmarking
        if (a === 224) return true;                                   // multicast
        if (a >= 240) return true;                                    // reserved
        return false;
    }
    if (version === 6) {
        const lower = ip.toLowerCase();
        if (lower === '::1') return true;                             // loopback
        if (lower === '::') return true;                              // unspecified
        if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local fe80::/10
        if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
        // IPv4-mapped / IPv4-compatible IPv6 — unwrap and re-check as IPv4
        const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateOrReservedIp(mapped[1]);
        return false;
    }
    return true; // not a recognizable IP at all — treat as unsafe
}

/**
 * Validate a URL's shape (HTTPS, non-null hostname) and its domain against
 * the vendor allowlist. Throws on failure. This is a synchronous, pre-DNS
 * check — always follow it with `assertResolvesToPublicIp` before connecting.
 */
function validateVendorUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`Invalid vendor URL format: ${rawUrl}`);
    }

    if (parsed.protocol !== 'https:') {
        throw new Error(`Vendor URL must use HTTPS. Got: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname.toLowerCase();

    if (hostname === 'localhost' || hostname === '0.0.0.0') {
        throw new Error('Blocked: vendor URL targets localhost');
    }

    // If the hostname is itself a literal IP (any notation getaddrinfo accepts),
    // validate it directly rather than deferring to DNS.
    if (net.isIP(hostname)) {
        if (isPrivateOrReservedIp(hostname)) {
            throw new Error(`Blocked: vendor URL targets private/internal IP: ${hostname}`);
        }
    }

    const isKnownVendor = ALLOWED_VENDOR_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
    if (!isKnownVendor) {
        throw new Error(`Blocked: vendor URL domain "${hostname}" is not on the allowed vendor list`);
    }

    return parsed;
}

/**
 * Resolve `hostname` and reject if ANY resolved address is private/loopback/
 * link-local/reserved. Returns the first public IP found — callers should
 * pin the connection to this exact IP (see `safeGet`) so a later, different
 * DNS answer for the same hostname can't be substituted in (DNS rebinding).
 */
function assertResolvesToPublicIp(hostname) {
    return new Promise((resolve, reject) => {
        if (net.isIP(hostname)) {
            // Already validated as a literal IP in validateVendorUrl.
            return resolve(hostname);
        }
        dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
            if (err) return reject(new Error(`Could not resolve vendor host "${hostname}": ${err.message}`));
            if (!addresses || addresses.length === 0) {
                return reject(new Error(`No addresses resolved for vendor host "${hostname}"`));
            }
            for (const { address } of addresses) {
                if (isPrivateOrReservedIp(address)) {
                    return reject(new Error(`Blocked: vendor host "${hostname}" resolves to private/internal IP ${address}`));
                }
            }
            resolve(addresses[0].address);
        });
    });
}

/**
 * SSRF-safe GET: validates the URL + resolved IP, pins the connection to that
 * IP (defeats DNS rebinding), and manually walks redirects (axios's own
 * `maxRedirects` does NOT re-validate the redirect target) re-running the
 * same checks on every hop. Use this instead of a bare `axios.get()` for any
 * vendor-supplied or webhook-supplied URL.
 */
async function safeGet(rawUrl, axiosConfig = {}, maxHops = 3) {
    let currentUrl = rawUrl;
    for (let hop = 0; hop <= maxHops; hop++) {
        const parsed = validateVendorUrl(currentUrl);
        const pinnedIp = await assertResolvesToPublicIp(parsed.hostname);

        const response = await axios.get(currentUrl, {
            ...axiosConfig,
            maxRedirects: 0,
            validateStatus: (status) => (status >= 200 && status < 300) || (status >= 300 && status < 400),
            // Pin the TCP connection to the IP we just validated instead of letting
            // the transport re-resolve DNS (which could return a different,
            // internal address on a rebinding attack).
            lookup: (_hostname, options, callback) => {
                if (typeof options === 'function') { callback = options; options = {}; }
                callback(null, pinnedIp, net.isIP(pinnedIp));
            },
        });

        if (response.status >= 300 && response.status < 400 && response.headers.location) {
            currentUrl = new URL(response.headers.location, currentUrl).toString();
            continue;
        }
        return response;
    }
    throw new Error(`Too many redirects (>${maxHops}) fetching vendor URL`);
}

module.exports = { validateVendorUrl, assertResolvesToPublicIp, isPrivateOrReservedIp, safeGet, ALLOWED_VENDOR_DOMAINS };

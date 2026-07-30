// Format ISO date string to readable local date/time
export const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export const formatDateTime = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Truncate a string with ellipsis
export const truncate = (str, max = 30) => {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
};

// Get initials from a full name
export const getInitials = (name = '') => {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
};

// Build a display-friendly hierarchy path
export const formatHierarchyPath = (path) => {
  if (!path || path === '/') return 'Root';
  return path.replace(/^\//, '').replace(/\/$/, '').split('/').join(' → ');
};

// Get the error message from an axios error
export const getErrorMessage = (error) => {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    'An unexpected error occurred.'
  );
};
// A GST *trade* name is not safe to display. When a business holds only a
// provisional GST registration the vendor returns a Temporary Reference Number
// in the trade/legal name fields instead of a real name — which is how strings
// like "272400510227TRN" end up on screen. The PAN controller guards against
// this now, but customer rows written before that guard still carry TRN values
// in `business_name` (which is itself derived trade-name-first).
//
// So: never trust a trade-derived name, and screen whatever is used for TRN
// artifacts. `business_name` stays as a last resort because for a lot of
// records it is a perfectly good manually-entered name (business_name_source
// === 'MANUAL').
const TRN_ARTIFACT_RE = /\d{6,}\s*TRN\s*$/i;

export const isUsableEntityName = (value) => {
  const name = String(value ?? '').trim();
  if (!name) return false;
  if (TRN_ARTIFACT_RE.test(name)) return false; // e.g. "272400510227TRN"
  if (/^\d+$/.test(name)) return false;         // a bare registration number is not a name
  return true;
};

/**
 * The one place that decides which name represents a customer on screen.
 *
 * Order: the plain KYC identity field first (user-entered, always reliable),
 * then the GST *legal* name, then the PAN holder name, and only then
 * `business_name`. Putting proprietor_name first preserves what the case
 * header, MSME dashboard and case wizard already did — this only changes what
 * happens when it is empty, which is exactly where the TRN was showing.
 *
 * @param {object|null} customer - a customer (or any object carrying these fields)
 * @param {string} fallback - returned when nothing usable exists
 */
export const resolveEntityName = (customer, fallback = '') => {
  if (!customer) return fallback;
  return [
    customer.proprietor_name,
    customer.legal_business_name,
    customer.pan_holder_name,
    customer.business_name,
  ].find(isUsableEntityName) || fallback;
};


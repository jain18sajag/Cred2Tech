/**
 * Which name represents a customer, for anything user-facing.
 *
 * A GST *trade* name is not safe to use. When a business holds only a
 * provisional GST registration, the vendor returns a Temporary Reference
 * Number in the trade/legal name fields rather than a real name — which is how
 * strings like "272400510227TRN" reach the screen. external.pan.controller
 * guards new writes (see isTrnStatus), but rows written before that guard still
 * carry TRN values in `business_name`, which is itself resolved trade-name-first.
 *
 * This matters most for `Case.customer_name`, a denormalized snapshot copied
 * from `customer.business_name`. Lists, PDD tasks, payouts, incentives and API
 * logs render that snapshot and have no customer relation to fall back to — so
 * a tainted value there cannot be repaired at the display layer. Resolve it
 * here, at the point of write, instead.
 *
 * Order: the plain KYC identity field first (user-entered, always reliable),
 * then the GST *legal* name, then the PAN holder name, and only then
 * `business_name` — which is kept as a last resort because for many records it
 * is a perfectly good manually-entered name (business_name_source === 'MANUAL').
 */

const TRN_ARTIFACT_RE = /\d{6,}\s*TRN\s*$/i;

/** A value is only usable as a display name if it isn't a TRN or a bare number. */
function isUsableEntityName(value) {
    const name = String(value ?? '').trim();
    if (!name) return false;
    if (TRN_ARTIFACT_RE.test(name)) return false; // e.g. "272400510227TRN"
    if (/^\d+$/.test(name)) return false;         // a bare registration number is not a name
    return true;
}

/**
 * @param {object|null} customer - a Customer row (or anything carrying these fields)
 * @param {string|null} fallback - returned when nothing usable exists
 * @returns {string|null}
 */
function resolveCustomerName(customer, fallback = null) {
    if (!customer) return fallback;
    return [
        customer.proprietor_name,
        customer.legal_business_name,
        customer.pan_holder_name,
        customer.business_name,
    ].find(isUsableEntityName) || fallback;
}

module.exports = { resolveCustomerName, isUsableEntityName };

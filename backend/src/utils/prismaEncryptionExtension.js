/**
 * Prisma Client Extension wiring transparent PII encryption into every
 * request that goes through the shared client (config/db.js) — no call-site
 * changes needed for the ~100+ read/write sites across the codebase.
 *
 * Scope note: Customer.business_pan is deliberately NOT included here even
 * though it's PAN data — it's used in a `contains` (partial-match) search
 * in case.service.js's case-list search bar, and deterministic AES-GCM
 * ciphertext cannot support substring search. Encrypting it would silently
 * break that search feature. It stays plaintext; flagged as a known gap.
 *
 * Nested writes (e.g. `case.create({ data: { applicants: { create: {...} } } })`)
 * are NOT covered by these per-model hooks — Prisma extensions only intercept
 * top-level model calls. The one confirmed nested-write site for an encrypted
 * field (case.service.js's createCase, which nests an Applicant.pan_number
 * write) is patched directly at that call site instead.
 */

const { encryptString, decryptString, encryptJson, decryptJson } = require('./fieldEncryption');

// field name -> { mode: 'deterministic' | 'random' | 'json' }
const MODEL_FIELDS = {
  applicant: {
    pan_number: 'deterministic',
    dob: 'random',
    pan_verified_dob: 'random',
    pan_verification_response: 'json',
  },
  customer: {
    dob: 'random',
    // business_pan intentionally excluded — see file header.
  },
  customerPanProfile: {
    pan: 'deterministic',
    raw_response: 'json',
  },
  itrAnalyticsRequest: {
    pan: 'deterministic',
    analytics_payload: 'json',
  },
  bankStatementAnalysisRequest: {
    auth_token: 'random',
    raw_analyze_response: 'json',
    raw_retrieve_response: 'json',
    raw_download_response: 'json',
  },
};

function encryptValue(value, mode) {
  if (mode === 'json') return encryptJson(value);
  return encryptString(value, { deterministic: mode === 'deterministic' });
}

function decryptValue(value, mode) {
  if (mode === 'json') return decryptJson(value);
  return decryptString(value);
}

function transformDataObject(data, fieldModes, direction) {
  if (!data || typeof data !== 'object') return data;
  const out = { ...data };
  for (const [field, mode] of Object.entries(fieldModes)) {
    if (out[field] !== undefined && out[field] !== null) {
      out[field] = direction === 'encrypt' ? encryptValue(out[field], mode) : decryptValue(out[field], mode);
    }
  }
  return out;
}

/** Encrypt deterministic-field equality filters in a `where` clause so lookups still match stored ciphertext. */
function transformWhereObject(where, fieldModes) {
  if (!where || typeof where !== 'object') return where;
  const out = { ...where };
  for (const [field, mode] of Object.entries(fieldModes)) {
    if (mode !== 'deterministic') continue; // random/json fields can't be searched by equality — leave untouched
    if (typeof out[field] === 'string') {
      out[field] = encryptString(out[field], { deterministic: true });
    } else if (out[field] && typeof out[field] === 'object' && typeof out[field].equals === 'string') {
      out[field] = { ...out[field], equals: encryptString(out[field].equals, { deterministic: true }) };
    } else if (out[field] && typeof out[field] === 'object' && Array.isArray(out[field].in)) {
      out[field] = { ...out[field], in: out[field].in.map((v) => (typeof v === 'string' ? encryptString(v, { deterministic: true }) : v)) };
    }
  }
  // AND/OR/NOT nested where clauses (e.g. the customer.business_pan search style) — recurse defensively.
  for (const boolKey of ['AND', 'OR', 'NOT']) {
    if (Array.isArray(out[boolKey])) {
      out[boolKey] = out[boolKey].map((clause) => transformWhereObject(clause, fieldModes));
    } else if (out[boolKey] && typeof out[boolKey] === 'object') {
      out[boolKey] = transformWhereObject(out[boolKey], fieldModes);
    }
  }
  return out;
}

function makeModelExtension(fieldModes) {
  return {
    async create({ args, query }) {
      if (args.data) args.data = transformDataObject(args.data, fieldModes, 'encrypt');
      return query(args);
    },
    async createMany({ args, query }) {
      if (Array.isArray(args.data)) {
        args.data = args.data.map((d) => transformDataObject(d, fieldModes, 'encrypt'));
      } else if (args.data) {
        args.data = transformDataObject(args.data, fieldModes, 'encrypt');
      }
      return query(args);
    },
    async update({ args, query }) {
      if (args.data) args.data = transformDataObject(args.data, fieldModes, 'encrypt');
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async updateMany({ args, query }) {
      if (args.data) args.data = transformDataObject(args.data, fieldModes, 'encrypt');
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async upsert({ args, query }) {
      if (args.create) args.create = transformDataObject(args.create, fieldModes, 'encrypt');
      if (args.update) args.update = transformDataObject(args.update, fieldModes, 'encrypt');
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async findUnique({ args, query }) {
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async findUniqueOrThrow({ args, query }) {
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async findFirst({ args, query }) {
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async findFirstOrThrow({ args, query }) {
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async findMany({ args, query }) {
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async count({ args, query }) {
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async delete({ args, query }) {
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
    async deleteMany({ args, query }) {
      if (args.where) args.where = transformWhereObject(args.where, fieldModes);
      return query(args);
    },
  };
}

const encryptionExtension = {
  name: 'pii-field-encryption',
  query: Object.fromEntries(
    Object.entries(MODEL_FIELDS).map(([model, fieldModes]) => [model, makeModelExtension(fieldModes)])
  ),
  result: Object.fromEntries(
    Object.entries(MODEL_FIELDS).map(([model, fieldModes]) => [
      model,
      Object.fromEntries(
        Object.entries(fieldModes).map(([field, mode]) => [
          field,
          {
            needs: { [field]: true },
            compute(record) {
              return decryptValue(record[field], mode);
            },
          },
        ])
      ),
    ])
  ),
};

module.exports = { encryptionExtension, MODEL_FIELDS };

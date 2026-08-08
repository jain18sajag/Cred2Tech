const crypto = require('crypto');
const prisma = require('../../config/db');
const { generateToken } = require('../utils/jwt');
const { hashPassword } = require('../utils/hash');
const { pushProfileToScheme } = require('../utils/crossAppProfileSync');

const hashOtp = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Shared by a normal OTP-verified login, the cross-app SSO bootstrap
// (sso-check), AND an incoming cross-app profile-sync push — all three
// ultimately just need "the local MSME_CUSTOMER user for this mobile,
// creating it on first-ever contact." Extracted so none of them can drift
// from the same tenant/role resolution + synthetic-email upsert logic.
// Deliberately does NOT issue a token or create a UserSession — a
// profile-sync push shouldn't spawn a spurious session on every login.
async function findOrCreateUser(mobile) {
  // Resolve Platform Tenant (CRED2TECH)
  const cred2techTenant = await prisma.tenant.findFirst({
    where: { type: 'CRED2TECH', status: 'ACTIVE' }
  });

  if (!cred2techTenant) {
    throw new Error('Platform configuration error: CRED2TECH tenant not found.');
  }

  // Resolve MSME_CUSTOMER Role
  const role = await prisma.role.findUnique({
    where: { name: 'MSME_CUSTOMER' }
  });

  if (!role) {
    throw new Error('Platform configuration error: MSME_CUSTOMER role not found.');
  }

  // Upsert User
  const email = `${mobile}@direct.cred2tech.local`;
  const randomPassword = crypto.randomUUID();
  const passwordHash = await hashPassword(randomPassword);

  return prisma.user.upsert({
    where: { email },
    create: {
      email,
      mobile,
      name: `Customer_${mobile}`,
      password_hash: passwordHash,
      role_id: role.id,
      tenant_id: cred2techTenant.id,
      status: 'ACTIVE'
    },
    update: {
      last_login_at: new Date()
    }
  });
}

async function findOrCreateAndIssueToken(mobile) {
  const user = await findOrCreateUser(mobile);

  const tokenPayload = {
    userId: user.id,
    roleId: user.role_id,
    roleName: 'MSME_CUSTOMER',
    tenantId: user.tenant_id,
  };

  const token = generateToken(tokenPayload);

  // Without this, the shared `authenticate` middleware's UserSession lookup
  // always finds nothing for an MSME token (only the staff login flow
  // created rows here before), so logout had nothing to actually revoke —
  // the token just stayed valid until its natural expiry regardless.
  await prisma.userSession.create({
    data: {
      user_id: user.id,
      session_token: token,
      is_active: true,
      last_activity_at: new Date()
    }
  });

  const { password_hash, ...safeUser } = user;

  // Best-effort, never awaited by the caller's response — a login shouldn't
  // get slower because the sibling app might be slow. Only ever sends data
  // this app has actually verified (see gatherVerifiedProfile) so a typo
  // never crosses apps as if it were trustworthy.
  gatherVerifiedProfile(user).then((profile) => {
    pushProfileToScheme(mobile, profile).catch(() => {});
  }).catch(() => {});

  return {
    success: true,
    user: safeUser,
    token,
    is_new_user: user.created_at.getTime() === user.updated_at.getTime()
  };
}

// What this app actually knows and trusts for a customer, worth telling the
// sibling app about. `name` only counts once it's a real name (not the
// `Customer_<mobile>` placeholder every new signup starts with) — dob/PAN
// only ever come from a Signzy-verified Applicant, never the raw typed
// fields, so a mistyped PAN can't propagate cross-app as if it were fact.
// business_name/email/pincode are plain prefill hints (same trust level as
// the sibling app's own synced_business_name/email/synced_pincode cache) —
// pulled from whatever case this customer has going, verified or not.
async function gatherVerifiedProfile(user) {
  const latestCase = await prisma.case.findFirst({
    where: { msme_customer_user_id: user.id },
    orderBy: { created_at: 'desc' },
    include: {
      customer: true,
      applicants: { where: { is_primary: true }, take: 1 }
    }
  });
  const applicant = latestCase?.applicants?.[0];
  const verifiedApplicant = applicant?.pan_verified ? applicant : null;
  const customer = latestCase?.customer;

  const isPlaceholderName = user.name === `Customer_${user.mobile}`;
  return {
    name: !isPlaceholderName ? user.name : (verifiedApplicant?.pan_verified_name || null),
    dob: verifiedApplicant?.pan_verified_dob || null,
    pan_number: verifiedApplicant?.pan_number || null,
    business_name: customer?.legal_business_name || customer?.business_name || null,
    email: customer?.business_email || null,
    pincode: applicant?.pincode || null,
  };
}

// Revokes every active session for a local user id — used by both a direct
// logout and a cross-app sso-revoke call (looked up by mobile first there).
async function revokeSessionsForUserId(userId) {
  await prisma.userSession.updateMany({
    where: { user_id: userId, is_active: true },
    data: { is_active: false }
  });
}

const directCustomerAuthService = {
  sendOtp: async (mobile) => {
    // 5 minutes expiry
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    
    // Check for recent requests (rate limit)
    const lastRecord = await prisma.loginOtp.findFirst({
      where: { mobile, purpose: 'MSME_CUSTOMER_LOGIN' },
      orderBy: { created_at: 'desc' }
    });

    if (lastRecord) {
      const timeDiffMs = new Date() - lastRecord.created_at;
      if (timeDiffMs < 30 * 1000) {
        throw new Error('Please wait 30 seconds before requesting another OTP.');
      }
    }

    await prisma.loginOtp.create({
      data: {
        mobile,
        otp_hash: otpHash,
        purpose: 'MSME_CUSTOMER_LOGIN',
        expires_at: expiresAt
      }
    });

    const isDev = process.env.NODE_ENV !== 'production';

    // In a real production scenario, trigger SMS Gateway here.
    return {
      success: true,
      otp: isDev ? otp : undefined,
      message: isDev ? 'OTP returned for development' : 'OTP sent via SMS'
    };
  },

  verifyOtp: async (mobile, otp) => {
    const record = await prisma.loginOtp.findFirst({
      where: {
        mobile,
        purpose: 'MSME_CUSTOMER_LOGIN',
        is_verified: false
      },
      orderBy: { created_at: 'desc' }
    });

    if (!record) {
      throw new Error('No active OTP request found for this mobile number.');
    }

    if (record.attempt_count >= 5) {
      throw new Error('Maximum verification attempts exceeded. Please request a new OTP.');
    }

    if (new Date() > record.expires_at) {
      throw new Error('OTP has expired. Please request a new one.');
    }

    const hashedInput = hashOtp(otp);
    if (hashedInput !== record.otp_hash) {
      await prisma.loginOtp.update({
        where: { id: record.id },
        data: { attempt_count: { increment: 1 } }
      });
      throw new Error('Invalid OTP');
    }

    await prisma.loginOtp.update({
      where: { id: record.id },
      data: {
        is_verified: true,
        verified_at: new Date()
      }
    });

    return findOrCreateAndIssueToken(mobile);
  },

  // Bootstraps a local session for a mobile number that was just proven to be
  // recently authenticated on scheme.cred2tech.com (verified via the c2t_sso
  // cookie in the controller before this is called) — no OTP involved here,
  // it's the same upsert-and-issue-token path a real OTP verify ends with.
  ssoLogin: async (mobile) => {
    return findOrCreateAndIssueToken(mobile);
  },

  // Revokes every session belonging to the authenticated caller — the next
  // request with the now-dead token gets rejected by the shared `authenticate`
  // middleware's UserSession.is_active check.
  logout: async (userId) => {
    await revokeSessionsForUserId(userId);
    return { success: true };
  },

  // Called by scheme.cred2tech.com's backend when a user logs out over there
  // — revokes this app's own sessions for the same mobile so a logout on
  // either side ends both. No-op (not an error) if this mobile has no local
  // account here yet.
  ssoRevoke: async (mobile) => {
    const email = `${mobile}@direct.cred2tech.local`;
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) await revokeSessionsForUserId(user.id);
    return { success: true };
  },

  // Called by scheme.cred2tech.com's backend with whatever verified profile
  // fields it has for this mobile. Auto-provisions the local user if this is
  // the very first time this mobile has been seen here (same as ssoLogin) so
  // the data is already waiting the first time this person actually visits —
  // that's the whole point, not just syncing existing accounts. Only ever
  // fills fields that are currently empty — a locally-verified value (this
  // app's own Applicant PAN, a name the user set here) always wins over
  // whatever the sibling app sends. business_name/email/pincode land in the
  // synced_* cache (never a live Customer/Applicant record) — same "prefill,
  // not fact" trust level as synced_dob/synced_pan_number above.
  ssoProfileSync: async (mobile, { name, dob, pan_number, business_name, email, pincode }) => {
    const user = await findOrCreateUser(mobile);
    const isPlaceholderName = user.name === `Customer_${mobile}`;

    const data = {};
    if (name && isPlaceholderName) data.name = name;
    if (dob && !user.synced_dob) data.synced_dob = dob;
    if (pan_number && !user.synced_pan_number) data.synced_pan_number = pan_number;
    if (business_name && !user.synced_business_name) data.synced_business_name = business_name;
    if (email && !user.synced_email) data.synced_email = email;
    if (pincode && !user.synced_pincode) data.synced_pincode = pincode;

    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data });
    }
    return { success: true };
  }
};

module.exports = directCustomerAuthService;

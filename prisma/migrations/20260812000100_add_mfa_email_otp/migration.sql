-- Pending email-OTP state for MFA setup/change (distinct from
-- mfa_challenges, which is login-time only). Purely additive.

-- CreateTable
CREATE TABLE "mfa_email_otps" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "pending_email" TEXT,
    "otp_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_email_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_email_otps_user_id_idx" ON "mfa_email_otps"("user_id");

-- AddForeignKey
ALTER TABLE "mfa_email_otps" ADD CONSTRAINT "mfa_email_otps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mandatory MFA: purely additive (new nullable/defaulted columns + new
-- tables). No existing column is altered or dropped, no existing row is
-- touched — safe to run against the live production database.
--
-- NOTE: `prisma migrate diff` against the live DB also reported a large
-- amount of unrelated pre-existing schema drift (dropped/altered tables
-- unrelated to MFA, some of which looked like real data tables). That drift
-- is NOT included here — it's a separate, pre-existing issue between
-- schema.prisma and the live DB that needs its own careful review before
-- ever being applied; this migration only contains the new MFA additions.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_email_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_totp_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_totp_secret" TEXT;

-- CreateTable
CREATE TABLE "mfa_backup_codes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "challenge_token_hash" TEXT NOT NULL,
    "method" TEXT,
    "otp_hash" TEXT,
    "otp_expires_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_audit_log" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" INTEGER,
    "ip_address" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_backup_codes_user_id_idx" ON "mfa_backup_codes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_challenges_challenge_token_hash_key" ON "mfa_challenges"("challenge_token_hash");

-- CreateIndex
CREATE INDEX "mfa_challenges_user_id_idx" ON "mfa_challenges"("user_id");

-- CreateIndex
CREATE INDEX "mfa_audit_log_user_id_idx" ON "mfa_audit_log"("user_id");

-- AddForeignKey
ALTER TABLE "mfa_backup_codes" ADD CONSTRAINT "mfa_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_audit_log" ADD CONSTRAINT "mfa_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_audit_log" ADD CONSTRAINT "mfa_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionReferenceType" ADD VALUE 'RAZORPAY_TOPUP';
ALTER TYPE "TransactionReferenceType" ADD VALUE 'EMPLOYEE_ALLOCATION';
ALTER TYPE "TransactionReferenceType" ADD VALUE 'EMPLOYEE_REVOCATION';

-- AlterTable
ALTER TABLE "wallet_transactions" ADD COLUMN     "idempotency_key" TEXT;

-- CreateTable
CREATE TABLE "wallet_topup_requests" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "requested_by_user_id" INTEGER NOT NULL,
    "amount_inr" DECIMAL(12,2) NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "credits_to_add" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "razorpay_event_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "verified_at" TIMESTAMP(3),
    "credited_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "raw_checkout_payload" JSONB,
    "raw_webhook_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_topup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "razorpay_webhook_events" (
    "id" SERIAL NOT NULL,
    "razorpay_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "razorpay_order_id" TEXT,
    "razorpay_payment_id" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "raw_payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "razorpay_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_wallets" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "allocated_balance" INTEGER NOT NULL DEFAULT 0,
    "consumed_credits" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_wallet_transactions" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "opening_balance" INTEGER NOT NULL,
    "closing_balance" INTEGER NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "idempotency_key" TEXT,
    "created_by_user_id" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_topup_requests_razorpay_order_id_key" ON "wallet_topup_requests"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_webhook_events_razorpay_event_id_key" ON "razorpay_webhook_events"("razorpay_event_id");

-- CreateIndex
CREATE INDEX "employee_wallets_tenant_id_idx" ON "employee_wallets"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_wallets_tenant_id_user_id_key" ON "employee_wallets"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_wallet_transactions_idempotency_key_key" ON "employee_wallet_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "employee_wallet_transactions_tenant_id_user_id_idx" ON "employee_wallet_transactions"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transactions_idempotency_key_key" ON "wallet_transactions"("idempotency_key");

-- AddForeignKey
ALTER TABLE "wallet_topup_requests" ADD CONSTRAINT "wallet_topup_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_topup_requests" ADD CONSTRAINT "wallet_topup_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_wallets" ADD CONSTRAINT "employee_wallets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_wallets" ADD CONSTRAINT "employee_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_wallet_transactions" ADD CONSTRAINT "employee_wallet_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_wallet_transactions" ADD CONSTRAINT "employee_wallet_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


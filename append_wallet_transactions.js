const fs = require('fs');

const file = './prisma/migrations/20260502000000_real_baseline/migration.sql';
let sql = fs.readFileSync(file, 'utf8');

const walletTransactionsSql = `
-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "reference_type" "TransactionReferenceType" NOT NULL,
    "reference_id" INTEGER,
    "api_code" TEXT,
    "remarks" TEXT,
    "balance_after" INTEGER NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_transactions_tenant_id_idx" ON "wallet_transactions"("tenant_id");

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
`;

sql += '\n' + walletTransactionsSql;

fs.writeFileSync(file, sql);
console.log('Appended wallet_transactions to baseline.');

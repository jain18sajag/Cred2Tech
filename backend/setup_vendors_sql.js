const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "vendors" (
        "id" SERIAL NOT NULL,
        "vendor_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "website" TEXT,
        "api_type" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        "contract_start" TIMESTAMP(3) NOT NULL,
        "contract_end" TIMESTAMP(3) NOT NULL,
        "billing_model" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'Active',
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "vendors_vendor_id_key" ON "vendors"("vendor_id");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "vendor_slabs" (
        "id" SERIAL NOT NULL,
        "vendor_id" INTEGER NOT NULL,
        "from_calls" INTEGER NOT NULL,
        "to_calls" INTEGER,
        "rate" DOUBLE PRECISION NOT NULL,
        CONSTRAINT "vendor_slabs_pkey" PRIMARY KEY ("id")
    );
  `);
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "vendor_slabs" ADD CONSTRAINT "vendor_slabs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    `);
  } catch (e) {
    console.log('Foreign key might already exist');
  }
  console.log('Tables created successfully!');
}

main().catch(console.error).finally(() => prisma.$disconnect());

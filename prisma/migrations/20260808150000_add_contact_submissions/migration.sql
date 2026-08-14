-- Contact Us leads from the public marketing site — see schema.prisma
-- comment above `ContactSubmission`.
-- Hand-authored (not `prisma migrate dev`'s shadow-db diff) to avoid
-- unrelated pre-existing drift between migration history and the live DB
-- (see 20260807030000_add_case_feedback/migration.sql for precedent).

-- CreateTable
CREATE TABLE "contact_submissions" (
    "id" SERIAL NOT NULL,
    "full_name" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "help_type" TEXT NOT NULL,
    "message" TEXT,
    "ip_address" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_submissions_created_at_idx" ON "contact_submissions"("created_at");

-- CreateIndex
CREATE INDEX "contact_submissions_is_read_idx" ON "contact_submissions"("is_read");

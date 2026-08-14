-- Feedback / Support Ticket system — see schema.prisma comment above `Ticket`.
-- Hand-authored (not `prisma migrate dev`'s shadow-db diff) to avoid pulling
-- in unrelated pre-existing drift between migration history and the live DB.

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('FEEDBACK', 'ISSUE');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketTimelineAction" AS ENUM ('CREATED', 'STATUS_CHANGED', 'INTERNAL_NOTE', 'REPLIED_TO_SUBMITTER', 'MARKED_READ');

-- CreateEnum
CREATE TYPE "TicketRecipientType" AS ENUM ('TO', 'CC');

-- CreateTable
CREATE TABLE "tickets" (
    "id" SERIAL NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "type" "TicketType" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "created_by_role" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "read_by_user_id" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_timeline_entries" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "action" "TicketTimelineAction" NOT NULL,
    "from_status" "TicketStatus",
    "to_status" "TicketStatus",
    "note" TEXT,
    "visible_to_submitter" BOOLEAN NOT NULL DEFAULT false,
    "performed_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_notification_recipients" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "type" "TicketRecipientType" NOT NULL,
    "label" TEXT,
    "created_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_notification_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticket_number_key" ON "tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_type_idx" ON "tickets"("type");

-- CreateIndex
CREATE INDEX "tickets_created_by_user_id_idx" ON "tickets"("created_by_user_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_idx" ON "tickets"("tenant_id");

-- CreateIndex
CREATE INDEX "tickets_read_at_idx" ON "tickets"("read_at");

-- CreateIndex
CREATE INDEX "ticket_attachments_ticket_id_idx" ON "ticket_attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_timeline_entries_ticket_id_idx" ON "ticket_timeline_entries"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_notification_recipients_email_type_key" ON "ticket_notification_recipients"("email", "type");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_read_by_user_id_fkey" FOREIGN KEY ("read_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_timeline_entries" ADD CONSTRAINT "ticket_timeline_entries_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_timeline_entries" ADD CONSTRAINT "ticket_timeline_entries_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_notification_recipients" ADD CONSTRAINT "ticket_notification_recipients_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Two-way ticket threading: the submitter can now reply back (not just
-- receive admin replies) — see ticket.service.js#addSubmitterMessage.
ALTER TYPE "TicketTimelineAction" ADD VALUE IF NOT EXISTS 'SUBMITTER_REPLIED';

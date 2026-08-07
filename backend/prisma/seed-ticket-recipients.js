// One-off seed for the default feedback/ticket notification recipients.
// Run once (`node prisma/seed-ticket-recipients.js`) — idempotent via the
// (email, type) unique constraint, safe to re-run. The admin panel owns
// this list from here on (see ticketRecipient.routes.js); this script only
// ever establishes the initial defaults, it is not run on every deploy.
const prisma = require('../config/db');

const DEFAULTS = [
  { email: 'contact@cred2tech.com', type: 'TO', label: 'Support inbox' },
  { email: 'bobby@cred2tech.com', type: 'CC', label: 'Bobby' },
  { email: 'sunil@cred2tech.com', type: 'CC', label: 'Sunil' },
];

async function main() {
  for (const recipient of DEFAULTS) {
    await prisma.ticketNotificationRecipient.upsert({
      where: { email_type: { email: recipient.email, type: recipient.type } },
      update: {},
      create: recipient,
    });
    console.log(`Seeded ${recipient.type} recipient: ${recipient.email}`);
  }
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

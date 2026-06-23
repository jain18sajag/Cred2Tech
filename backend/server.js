require('dotenv').config({ override: true });
const app = require('./src/app');
const prisma = require('./config/db');
const dataPullWorker = require('./src/workers/dataPull.worker');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await prisma.$connect();
    console.log('Database connected successfully.');

    // Safe Backfill Policy
    const { runSafeBackfill } = require('./src/utils/backfill');
    await runSafeBackfill();

    // Start Data Pull Worker
    dataPullWorker.start();

    const server = app.listen(PORT);

    // Only announce success on the real 'listening' event (not the listen
    // callback, which Express can still invoke when the bind fails).
    server.on('listening', () => {
      console.log(`Server is running on port ${PORT}`);
    });

    // Surface bind failures loudly instead of exiting silently. The most common
    // one in local dev on macOS is the AirPlay Receiver squatting on port 5000.
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`\nERROR: Port ${PORT} is already in use — the server did NOT start.`);
        console.error('On macOS, port 5000 is taken by the AirPlay Receiver by default.');
        console.error('Fix: disable it (System Settings → General → AirDrop & Handoff →');
        console.error('"AirPlay Receiver"), or set a free port via PORT=... in your .env.\n');
      } else {
        console.error('HTTP server error:', error);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

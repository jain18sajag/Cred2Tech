const { Client } = require('pg');

class PgPubSubService {
    constructor() {
        this.client = null;
        this.listeners = new Map(); // channel -> Array of callbacks
        this.isConnected = false;
        this.connectionPromise = null;
    }

    async connect() {
        if (this.isConnected) return;
        if (this.connectionPromise) return this.connectionPromise;

        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            console.warn('[pgPubSub] No DATABASE_URL provided. Cannot start LISTEN/NOTIFY.');
            return;
        }

        this.client = new Client({ connectionString });

        this.client.on('notification', (msg) => {
            const channel = msg.channel;
            const payload = msg.payload;
            const callbacks = this.listeners.get(channel);

            if (callbacks) {
                let parsedPayload;
                try {
                    parsedPayload = JSON.parse(payload);
                } catch (e) {
                    parsedPayload = payload;
                }
                callbacks.forEach(cb => {
                    try {
                        cb(parsedPayload);
                    } catch (err) {
                        console.error(`[pgPubSub] Error in listener callback for channel ${channel}:`, err);
                    }
                });
            }
        });

        this.client.on('error', (err) => {
            console.error('[pgPubSub] Client error:', err);
            this.isConnected = false;
            this.client = null;
            this.connectionPromise = null;
            // Attempt to reconnect after a short delay
            setTimeout(() => this.connect(), 5000);
        });

        this.connectionPromise = this.client.connect().then(async () => {
            this.isConnected = true;
            console.log('[pgPubSub] Connected to PostgreSQL for LISTEN/NOTIFY');

            // Resubscribe to existing channels
            for (const channel of this.listeners.keys()) {
                try {
                    await this.client.query(`LISTEN ${channel}`);
                    console.log(`[pgPubSub] Resubscribed to channel: ${channel}`);
                } catch (err) {
                    console.error(`[pgPubSub] Failed to resubscribe to ${channel}:`, err);
                }
            }
        }).catch(err => {
            console.error('[pgPubSub] Failed to connect:', err);
            this.connectionPromise = null;
        });

        return this.connectionPromise;
    }

    async listen(channel, callback) {
        if (!this.listeners.has(channel)) {
            this.listeners.set(channel, []);
        }
        this.listeners.get(channel).push(callback);

        if (this.isConnected) {
            try {
                await this.client.query(`LISTEN ${channel}`);
                console.log(`[pgPubSub] Listening on channel: ${channel}`);
            } catch (err) {
                console.error(`[pgPubSub] Failed to listen to ${channel}:`, err);
            }
        }
    }

    /**
     * Helper to explicitly disconnect.
     */
    async disconnect() {
        if (this.client) {
            await this.client.end();
            this.isConnected = false;
            this.client = null;
            this.connectionPromise = null;
        }
    }
}

// Export singleton
const pgPubSubService = new PgPubSubService();
module.exports = pgPubSubService;

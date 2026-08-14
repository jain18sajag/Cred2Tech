const EventEmitter = require('events');

class SseService {
    constructor() {
        this.clients = new Map(); // caseId -> Set of response objects
        this.heartbeatInterval = null;
        
        // Use an internal emitter to broadcast Postgres events to HTTP responses
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(0); // unlimited
        
        this.startHeartbeat();
    }

    /**
     * Add a new client connection for a specific case
     */
    addClient(caseId, res) {
        if (!this.clients.has(caseId)) {
            this.clients.set(caseId, new Set());
        }
        this.clients.get(caseId).add(res);

        // Send initial connection success message
        this.sendToClient(res, 'connected', { message: 'Successfully connected to pull-status-stream' });
    }

    /**
     * Remove a client connection
     */
    removeClient(caseId, res) {
        if (this.clients.has(caseId)) {
            this.clients.get(caseId).delete(res);
            if (this.clients.get(caseId).size === 0) {
                this.clients.delete(caseId);
            }
        }
    }

    /**
     * Broadcast an event to all clients listening to a specific caseId
     */
    broadcastToCase(caseId, eventName, data) {
        if (this.clients.has(caseId)) {
            const clients = this.clients.get(caseId);
            clients.forEach(res => {
                this.sendToClient(res, eventName, data);
            });
        }
    }

    /**
     * Format and send SSE message
     */
    sendToClient(res, eventName, data) {
        try {
            res.write(`event: ${eventName}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error('[SseService] Failed to send message to client:', error);
        }
    }

    /**
     * Keep-alive heartbeat to prevent reverse-proxy timeouts
     */
    startHeartbeat() {
        // Send a comment heartbeat every 30 seconds. unref() so this timer
        // alone never keeps the Node process alive (e.g. CI smoke tests that
        // just require() this module and expect the process to exit).
        this.heartbeatInterval = setInterval(() => {
            this.clients.forEach(clientsSet => {
                clientsSet.forEach(res => {
                    try {
                        res.write(': heartbeat\n\n');
                    } catch (e) {
                        // Ignore dead connections
                    }
                });
            });
        }, 30000);
        this.heartbeatInterval.unref();
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
    }
}

// Export singleton
const sseService = new SseService();
module.exports = sseService;

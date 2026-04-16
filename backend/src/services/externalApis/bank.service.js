const axios = require('axios');

// Internal memory caching for simplistic auth token lifecycle management
let _cachedToken = null;
let _tokenExpiry = null;

// Export for test/debug resets
function clearTokenCache() { _cachedToken = null; _tokenExpiry = null; }

async function getProviderConfig() {
    const rawBase = (process.env.SIGNZY_BASE_URL || 'https://api-preproduction.signzy.app').replace(/\/+$/, '');
    const username = process.env.SIGNZY_USERNAME;
    const password = process.env.SIGNZY_PASSWORD;
    const apiKey   = process.env.SIGNZY_AUTH_TOKEN;

    if (!username || !password) {
        throw new Error('Signzy provider config missing (SIGNZY_USERNAME / SIGNZY_PASSWORD for Statement Analysis)');
    }
    if (!apiKey) {
        throw new Error('Signzy provider config missing (SIGNZY_AUTH_TOKEN required to call authenticate endpoint)');
    }

    // Normalise: ensure we NEVER double-append /api/v3
    const apiBase = rawBase.endsWith('/api/v3') ? rawBase : `${rawBase}/api/v3`;

    return { apiBase, username, password, apiKey };
}

function parseError(error) {
    const providerError = error.response?.data;
    const errorMessage = providerError?.error?.message || providerError?.message || error.message || 'Provider failure';
    
    const enhancedError = new Error(`${errorMessage}`);
    if (error.response?.status) {
        enhancedError.status = error.response.status;
    }
    return enhancedError;
}

function handleResponse(response) {
    if (response.data && response.data.error) {
        const errorMsg = response.data.error.message || response.data.error.reason || 'Provider API returned an error';
        const enhancedError = new Error(errorMsg);
        enhancedError.status = response.data.error.status || 400;
        throw enhancedError;
    }
    // Signzy Statement analysis puts things directly on body or inside 'result'
    return response.data;
}

async function authenticate() {
    // Return cached token if still valid (24h lifecycle)
    if (_cachedToken && _tokenExpiry && Date.now() < _tokenExpiry) {
        return _cachedToken;
    }

    const { apiBase, username, password, apiKey } = await getProviderConfig();

    try {
        console.log(`[bank.service] Authenticating at: ${apiBase}/statementanalysis/authenticate | username: ${username}`);
        const response = await axios.post(
            `${apiBase}/statementanalysis/authenticate`,
            { username, password },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': apiKey  // Required per Signzy docs — platform API key
                }
            }
        );
        
        const data = handleResponse(response);
        if (data.authToken) {
            _cachedToken = data.authToken;
            // Valid for 24 hours (23.5 hours for safety margin)
            _tokenExpiry = Date.now() + (23.5 * 60 * 60 * 1000);
            return _cachedToken;
        }
        throw new Error('Authentication failed: No authToken returned from provider');
    } catch (error) {
        throw parseError(error);
    }
}

async function analyzeStatement(filesPayload) {
    const token = await authenticate();
    const { apiBase } = await getProviderConfig();
    
    try {
        const response = await axios.post(
            `${apiBase}/statementanalysis/analyze-statement`,
            { files: filesPayload },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

async function retrieveWorkOrder(reportId) {
    const token = await authenticate();
    const { apiBase } = await getProviderConfig();
    
    try {
        const response = await axios.post(
            `${apiBase}/statementanalysis/retrieve-work-order`,
            { reportId },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

async function downloadReport(reportId, fileType = 'excel and json') {
    const token = await authenticate();
    const { apiBase } = await getProviderConfig();
    
    try {
        const response = await axios.post(
            `${apiBase}/statementanalysis/download-report`,
            { reportId, fileType },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

module.exports = {
    authenticate,
    analyzeStatement,
    retrieveWorkOrder,
    downloadReport
};

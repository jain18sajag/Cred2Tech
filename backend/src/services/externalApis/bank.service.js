const axios = require('axios');
const FormData = require('form-data');

// Internal memory caching for simplistic auth token lifecycle management
let _cachedToken = null;
let _tokenExpiry = null;

// Export for test/debug resets
function clearTokenCache() { _cachedToken = null; _tokenExpiry = null; }

async function getProviderConfig() {
    const rawBase = (process.env.SIGNZY_BASE_URL || 'https://api-preproduction.signzy.app').trim().replace(/\/+$/, '');
    const username = process.env.SIGNZY_USERNAME?.trim();
    const password = process.env.SIGNZY_PASSWORD?.trim();
    const apiKey = process.env.SIGNZY_AUTH_TOKEN?.trim();

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

// Helper to convert base64 payload into Signzy's internal persisted file URL
async function uploadFileToSignzy(base64Content, fileName) {
    try {
        const form = new FormData();
        form.append('file', Buffer.from(base64Content, 'base64'), { filename: fileName || 'statement.pdf' });

        const res = await axios.post('https://persist.signzy.tech/api/files/upload', form, {
            headers: { ...form.getHeaders() }
        });

        if (res.data?.file?.directURL) {
            return res.data.file.directURL;
        }
        throw new Error('No directURL received from Signzy persist API');
    } catch (error) {
        throw new Error(`Signzy File Upload Error: ${error.message}`);
    }
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
    const { apiBase, apiKey } = await getProviderConfig();

    try {
        const preparedFiles = [];
        for (const fileObj of filesPayload) {
            if (fileObj.fileBase64) {
                const url = await uploadFileToSignzy(fileObj.fileBase64, fileObj.fileName);
                preparedFiles.push({ fileUrl: url, password: fileObj.password || undefined });
            } else if (fileObj.fileUrl) {
                preparedFiles.push({ fileUrl: fileObj.fileUrl, password: fileObj.password || undefined });
            }
        }

        const response = await axios.post(
            `${apiBase}/statementanalysis/analyze-statement`,
            { authToken: token, files: preparedFiles },
            {
                headers: {
                    'Authorization': apiKey,
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
    const { apiBase, apiKey } = await getProviderConfig();

    try {
        const response = await axios.post(
            `${apiBase}/statementanalysis/retrieve-work-order`,
            { authToken: token, reportId },
            {
                headers: {
                    'Authorization': apiKey,
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
    const { apiBase, apiKey } = await getProviderConfig();

    try {
        const response = await axios.post(
            `${apiBase}/statementanalysis/download-report`,
            { authToken: token, reportId, fileType },
            {
                headers: {
                    'Authorization': apiKey,
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

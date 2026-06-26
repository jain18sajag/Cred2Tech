const axios = require('axios');

function getProviderConfig() {
    const baseUrl = process.env.SIGNZY_BASE_URL || 'https://api-preproduction.signzy.app';
    const authToken = process.env.SIGNZY_AUTH_TOKEN;

    if (!authToken) {
        throw new Error('Signzy provider config missing (SIGNZY_AUTH_TOKEN for ITR Analytics)');
    }

    // Build the API v3 base regardless of what is stored in SIGNZY_BASE_URL
    const apiBase = baseUrl.includes('/api/v3')
        ? baseUrl
        : `${baseUrl}/api/v3`;

    return { apiBase, authToken };
}

function parseError(error) {
    const providerError = error.response?.data;
    const errorMessage =
        providerError?.error?.message ||
        providerError?.message ||
        error.message ||
        'Provider failure';

    const enhancedError = new Error(errorMessage);
    if (error.response?.status) enhancedError.status = error.response.status;
    return enhancedError;
}

function handleResponse(response) {
    if (response.data && response.data.error) {
        const errorMsg =
            response.data.error.message ||
            response.data.error.reason ||
            'Provider API returned an error';
        const enhancedError = new Error(errorMsg);
        enhancedError.status = response.data.error.status || 400;
        throw enhancedError;
    }
    return response.data.result || response.data;
}
/**
 * Step 1 (New): Get Request ID
 * POST /api/v3/itr/requestId
 */
async function initiateRequestId(pan) {
    const { apiBase, authToken } = getProviderConfig();
    try {
        const response = await axios.post(
            `${apiBase}/itr/requestId`,
            { userName: pan.toUpperCase() },
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Step 2 (New): Authorisation
 * POST /api/v3/itr/authorisation
 */
async function submitAuthorisation(requestId, { otp, password }) {
    const { apiBase, authToken } = getProviderConfig();
    const payload = { requestId };
    if (otp) payload.otp = otp;
    if (password) payload.password = password;

    try {
        const response = await axios.post(
            `${apiBase}/itr/authorisation`,
            payload,
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Step 3 (New): Get ITR Form
 * POST /api/v3/itr/getitrform
 */
async function fetchItrForm(requestId) {
    const { apiBase, authToken } = getProviderConfig();
    try {
        const response = await axios.post(
            `${apiBase}/itr/getitrform`,
            { requestId, range: 3 },
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}


/**
 * Step 1: Get Reference ID
 * POST /api/v3/itr-analytics/get-reference-id
 * Returns { referenceId, statusMessage }
 */
async function getReferenceId(pan, password) {
    const { apiBase, authToken } = getProviderConfig();

    try {
        const response = await axios.post(
            `${apiBase}/itr-analytics/get-reference-id`,
            { username: pan, password },
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

/**
 * Step 2: Get Analytics
 * POST /api/v3/itr-analytics/get-analytics
 * Returns { excelUrl, data, statusMessage, referenceId }
 */
async function getAnalytics(referenceId) {
    const { apiBase, authToken } = getProviderConfig();

    try {
        const response = await axios.post(
            `${apiBase}/itr-analytics/get-analytics`,
            { referenceId },
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

module.exports = {
    initiateRequestId,
    submitAuthorisation,
    fetchItrForm,
    getReferenceId,
    getAnalytics
};

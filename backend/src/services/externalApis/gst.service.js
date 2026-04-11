const axios = require('axios');

async function getProviderConfig() {
    const baseUrl = process.env.SIGNZY_BASE_URL;
    const authToken = process.env.SIGNZY_AUTH_TOKEN;

    if (!baseUrl || !authToken) {
        throw new Error('Signzy API credentials are not configured');
    }

    return { baseUrl, authToken };
}

function parseError(error) {
    const providerError = error.response?.data;
    const errorMessage = providerError?.error?.message || providerError?.message || error.message || 'Provider failure';
    return new Error(`${errorMessage}`);
}

function handleResponse(response) {
    if (response.data && response.data.error) {
        const errorMsg = response.data.error.message || response.data.error.reason || 'Provider API returned an error';
        throw new Error(errorMsg);
    }
    return response.data.result || response.data;
}

async function createRequest(payload) {
    const { baseUrl, authToken } = await getProviderConfig();

    try {
        const response = await axios.post(
            `${baseUrl}/gstr-analytics/create-request`,
            payload,
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

async function submitOtp(requestId, otp) {
    const { baseUrl, authToken } = await getProviderConfig();

    try {
        const response = await axios.post(
            `${baseUrl}/gstr-analytics/submit-otp`,
            { requestId, otp },
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

async function fetchData(requestId) {
    const { baseUrl, authToken } = await getProviderConfig();

    try {
        const response = await axios.post(
            `${baseUrl}/gstr-analytics/fetch-data`,
            { requestId },
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

async function fetchReport(requestId) {
    const { baseUrl, authToken } = await getProviderConfig();

    try {
        const response = await axios.post(
            `${baseUrl}/account-aggregator-switch/fetch-report`,
            { requestId },
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

async function createAuthLink(payload) {
    const { baseUrl, authToken } = await getProviderConfig();

    try {
        const response = await axios.post(
            `${baseUrl}/underwriting/create-gstr-authlink`,
            payload,
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 20000
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

module.exports = {
    createRequest,
    submitOtp,
    fetchData,
    fetchReport,
    createAuthLink
};

const axios = require('axios');

async function getProviderConfig() {
    const baseUrl = process.env.SIGNZY_BASE_URL;
    const authToken = process.env.SIGNZY_AUTH_TOKEN;

    if (!baseUrl || !authToken) {
        throw new Error('Signzy provider config missing');
    }

    return { baseUrl, authToken };
}

function parseError(error) {
    const providerError = error.response?.data;
    const errorMessage = providerError?.error?.message || providerError?.message || error.message || 'Provider failure';
    
    // Pass along 409 status code specifically if it was provided, so the caller can act on it
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
    return response.data.result || response.data;
}

async function pullItr(payload) {
    const { baseUrl, authToken } = await getProviderConfig();

    try {
        const endpoint = baseUrl.includes('/api/v3') 
            ? `${baseUrl}/itr/itr-pull` 
            : `${baseUrl}/api/v3/itr/itr-pull`;

        const response = await axios.post(
            endpoint,
            payload,
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // ITR pulls can take a while
            }
        );
        return handleResponse(response);
    } catch (error) {
        throw parseError(error);
    }
}

module.exports = {
    pullItr
};

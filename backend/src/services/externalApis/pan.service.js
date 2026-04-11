const axios = require('axios');

async function fetchPanIntelligence(panNumber) {
    const baseUrl = process.env.SIGNZY_BASE_URL;
    const authToken = process.env.SIGNZY_AUTH_TOKEN;

    if (!baseUrl || !authToken) {
        throw new Error('Signzy API credentials are not configured');
    }

    try {
        const payload = {
            panNumber: panNumber
        };

        const response = await axios.post(
            `${baseUrl}/intellibiz/pan-to-intellibiz`,
            payload,
            {
                headers: {
                    'Authorization': authToken,
                    'Content-Type': 'application/json'
                },
                timeout: 15000 // Handle provider timeouts
            }
        );

        if (!response.data || !response.data.result) {
            throw new Error('Invalid response structure from provider');
        }

        return response.data.result;

    } catch (error) {
        const providerError = error.response?.data;
        const errorMessage = providerError?.error?.message || providerError?.message || error.message || 'Provider failure';
        throw new Error(`${errorMessage}`);
    }
}

module.exports = {
    fetchPanIntelligence
};

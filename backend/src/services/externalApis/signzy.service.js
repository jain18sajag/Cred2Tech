const axios = require('axios');

const getSignzyToken = () => process.env.SIGNZY_AUTH_TOKEN;

// Depending on your deployment logic, you could switch this URL based on NODE_ENV,
// but as requested we will use the preproduction one, or fall back if you define a base url env.
const getSignzyBaseUrl = () => process.env.SIGNZY_BASE_URL || 'https://api-preproduction.signzy.app/api/v3';

exports.verifyPanSimple = async (pan) => {
    if (!pan) throw new Error("PAN is required");

    const token = getSignzyToken();
    if (!token) {
        throw new Error("Signzy Authorization Token is not configured (missing SIGNZY_AUTH_TOKEN).");
    }

    try {
        const response = await axios.post(
            `${getSignzyBaseUrl()}/pan/simple`,
            { panNumber: pan },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token
                },
                timeout: 10000 // 10 seconds timeout
            }
        );

        const data = response.data;
        if (data && data.result) {
            return {
                name: data.result.name || null,
                firstName: data.result.firstName || null,
                lastName: data.result.lastName || null,
                dob: data.result.dob || null, // e.g. "2000-01-01"
                panStatus: data.result.panStatus || null,
                rawResponse: data
            };
        }

        throw new Error("Invalid response from PAN verification service");
    } catch (error) {
        console.error('[Signzy Service] Error verifying PAN:', error.response?.data || error.message);
        
        // Detailed error parsing
        if (error.response) {
            const status = error.response.status;
            const errMsg = error.response.data?.message || error.response.data?.error || JSON.stringify(error.response.data);
            
            if (status === 401 || status === 403) {
                throw new Error("Signzy Authentication failed. Please check your SIGNZY_AUTH_TOKEN.");
            }
            if (status === 400 || status === 422) {
                throw new Error(`Invalid PAN: ${errMsg}`);
            }
            throw new Error(`PAN verification failed (${status}): ${errMsg}`);
        }
        
        throw new Error(`PAN verification failed: ${error.message}`);
    }
};

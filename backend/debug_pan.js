const axios = require('axios');
const prisma = require('./config/db');

async function testFlow() {
  try {
    const user = await prisma.user.findFirst({ where: { role: { name: 'DSA_MEMBER' } } });
    if (!user) {
        console.log("No user found");
        return;
    }
    
    console.log("Testing auth login...");
    // Let's just mock the auth or we need the password. 
    // We can also just use the token API or create a token manually via jwt since we have the secret.
    const { generateToken } = require('./src/utils/jwt');
    const token = generateToken({ id: user.id, email: user.email, role: 'DSA_MEMBER' });
    
    const api = axios.create({
      baseURL: 'http://localhost:5000',
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const testPan = 'ABCDE1111X';
    
    console.log("Checking existing...");
    try {
        const checkRes = await api.get(`/customers/check-existing-by-pan?pan=${testPan}`);
        console.log("Check existing:", checkRes.data);
    } catch (err) {
        console.log("Check existing error:", err.response ? err.response.data : err.message);
    }
    
    console.log("Creating or attaching...");
    let customerId;
    try {
        const createRes = await api.post('/customers/create-or-attach', { business_pan: testPan });
        console.log("Create resp:", createRes.data);
        customerId = createRes.data.id;
    } catch (err) {
       console.log("Create error:", err.response ? err.response.data : err.message);
       return;
    }
    
    console.log("Testing POST /external/pan/fetch...");
    try {
        const panRes = await api.post('/external/pan/fetch', {
            customer_id: customerId,
            pan: testPan,
            consentMethod: 'DIRECT_LOGIN'
        });
        console.log("Fetch resp:", panRes.data);
    } catch (err) {
        console.log("Fetch error:", err.response ? err.response.data : err.message);
    }
  } catch (err) {
      console.error("Setup error:", err);
  }
}

testFlow();

require('dotenv').config();
const bankService = require('./src/services/externalApis/bank.service');

async function getToken() {
    const token = await bankService.authenticate();
    console.log("Here is the token:", token);
}

getToken();
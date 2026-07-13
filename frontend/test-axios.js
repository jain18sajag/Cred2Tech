const axios = require('axios');
const api = axios.create();
api.interceptors.request.use(config => {
  config.headers.Authorization = 'Bearer test';
  return config;
});
api.interceptors.request.use(config => {
  console.log("Headers:", config.headers);
  return config;
});
api.get('http://localhost:5000', { headers: { 'Cache-Control': 'no-cache' } }).catch(()=>null);

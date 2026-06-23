const fs = require('fs');
let content = fs.readFileSync('src/routes/AppRouter.jsx', 'utf8');

const rolesToReplace = /allowedRoles=\{\['DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN', 'SUB_DSA'\]\}/g;
const newRoles = "allowedRoles={['DSA_ADMIN', 'DSA_MEMBER', 'SUPER_ADMIN', 'SUB_DSA', 'MSME_CUSTOMER']}";

content = content.replace(rolesToReplace, newRoles);

fs.writeFileSync('src/routes/AppRouter.jsx', content);
console.log('AppRouter roles updated');

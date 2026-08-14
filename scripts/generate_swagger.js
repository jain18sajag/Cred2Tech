const swaggerAutogen = require('swagger-autogen')({ openapi: '3.0.0' });

const doc = {
  info: {
    title: 'Cred2Tech MSME API Platform',
    description: 'Internal API powering the Multi-tenant Cred2Tech CRM platform',
    version: '1.0.0',
  },
  servers: [
    {
      url: 'http://localhost:5000',
      description: 'Local Development Server'
    }
  ],
  tags: [
    { name: 'Auth', description: 'Authentication and Tokens' },
    { name: 'Tenant Management', description: 'DSA tracking and administration' },
    { name: 'Wallet', description: 'DSA Wallet Balance checking and APIs' },
    { name: 'API Pricing', description: 'Platform pricing structures' },
    { name: 'API Usage Logs', description: 'Audit trail for paid API execution' },
    { name: 'Customers', description: 'MSME onboarding pipeline' },
    { name: 'Cases', description: 'Loan Origination Application Tracking' },
    { name: 'Integrations', description: 'External Provider hooks (GST, ITR, Bureau)' },
    { name: 'Admin Controls', description: 'Superadmin specific elevated actions' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      }
    },
    schemas: {
      Pagination: {
        page: 1,
        limit: 50,
        total: 152,
        totalPages: 4
      },
      WalletTransaction: {
        id: 1,
        tenant_id: 2,
        amount: 15,
        transaction_type: 'DEBIT',
        reference_type: 'API_CALL',
        api_code: 'GST_FETCH',
        balance_after: 85,
        created_at: '2026-04-04T12:00:00Z'
      },
      ApiUsageLog: {
        id: 101,
        tenant_id: 2,
        api_code: 'GST_FETCH',
        status: 'SUCCESS',
        credits_used: 15,
        created_at: '2026-04-04T12:00:00Z'
      },
      ApiPricing: {
        id: 1,
        api_code: 'GST_FETCH',
        default_credit_cost: 15,
        is_active: true
      },
      Tenant: {
        id: 2,
        name: 'Alpha DSA Finance',
        type: 'DSA',
        status: 'ACTIVE'
      },
      Customer: {
        id: 14,
        business_pan: 'ABCDE1234F',
        business_name: 'Test Corp'
      },
      Case: {
        id: 21,
        stage: 'DATA_COLLECTION',
        product_type: 'LAP'
      },
      User: {
        id: 4,
        name: 'John Doe',
        email: 'john@dsa.com',
        role_id: 3
      }
    }
  },
  security: [{
    bearerAuth: []
  }]
};

const outputFile = './docs/swagger.json';
const endpointsFiles = [
   './src/app.js',
   './src/routes/auth.routes.js',
   './src/routes/user.routes.js',
   './src/routes/tenant.routes.js',
   './src/routes/analytics.routes.js',
   './src/routes/role.routes.js',
   './src/routes/customer.routes.js',
   './src/routes/case.routes.js',
   './src/routes/otp.routes.js',
   './src/routes/dsa.wallet.routes.js',
   './src/routes/admin.wallet.routes.js',
   './src/routes/adminApiLogs.routes.js',
   './src/routes/externalApi.routes.js'
];

// Generate docs recursively crawling the Express App!
swaggerAutogen(outputFile, endpointsFiles, doc).then(() => {
    console.log("Swagger UI Successfully Generated down into ./docs/swagger.json");
});

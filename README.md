# Cred2Tech Backend

Express + Prisma / PostgreSQL API for the Cred2Tech platform.

This repo is backend-only. It used to also carry an internal testing
frontend (`frontend/`), which has been retired — dev/testing work now
happens on branches deployed by the development pipeline (see below), and
the real production frontend is a separate repo, `Cred2Tech-WebApp`.

## CI/CD

- `Jenkinsfile` — production. Deploys `main` to `prod.api.cred2tech.com`.
  Pre-deploy DB backup (blocking), approval gate, health check, automatic
  code rollback on failure.
- `Jenkinsfile.dev` — development. Deploys any other branch to a
  developer-only environment, no approval gate, migrations always applied.
- `Jenkinsfile.rollback` — manual code and/or database rollback for
  production.

Both pipeline files document their own Jenkins job / server setup
requirements inline.

## Local development

```
npm install
npx prisma generate
npm start   # nodemon server.js
```

See `.env.example` for required environment variables.

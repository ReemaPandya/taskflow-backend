# Pre-Submission Checklist

## Repository

- [ ] Run `npm install` once on a machine with npm registry access and commit the generated `package-lock.json`.
- [ ] Confirm `.env` and `.env.test` are not tracked: `git status`.
- [ ] Keep `.env.example` and `.env.test.example` public.
- [ ] Push to a **public** GitHub repository.

## Build and runtime

- [ ] `cp .env.example .env`
- [ ] Replace both JWT secrets in `.env`.
- [ ] `docker compose up --build -d`
- [ ] `docker compose ps` shows PostgreSQL, Redis, API and Worker running/healthy.
- [ ] `docker compose exec api node dist/prisma/seed.js`
- [ ] Open `http://localhost:3000/health` and verify PostgreSQL/Redis are `ok`.
- [ ] Open `http://localhost:3000/docs`.

## Required behavior

- [ ] Login as `admin@acme.test / Password123!`.
- [ ] Create/read/update/delete a task.
- [ ] Filter tasks by status/priority/assignee/due date.
- [ ] Verify project dashboard task counts.
- [ ] Login as Globex and request an Acme project UUID; confirm **403** and no project body.
- [ ] Assign an Acme member to an Acme task and capture `jobId`.
- [ ] Check `GET /jobs/:id` until `completed`.
- [ ] Watch `docker compose logs -f worker` and show the mocked email.

## Tests

- [ ] `npm test`
- [ ] `cp .env.test.example .env.test`
- [ ] `docker compose --profile test up -d postgres-test redis-test`
- [ ] Wait for test containers to become healthy.
- [ ] `DATABASE_URL=postgresql://taskflow:taskflow@localhost:5433/taskflow_test?schema=public npx prisma migrate deploy`
- [ ] `npm run test:integration`
- [ ] Optional: `npm run test:coverage:all`

## Documentation

- [ ] README setup commands work from a fresh clone.
- [ ] Swagger UI opens locally.
- [ ] Import `TaskFlow.postman_collection.json` into Postman and run requests without editing IDs manually.
- [ ] Review `ARCHITECTURE.md`, especially multi-tenancy and transactional-outbox decisions.
- [ ] Record the demo using `DEMO_SCRIPT.md`.

## Submission form

- [ ] GitHub repository link is public.
- [ ] Demo video link is public/unlisted and accessible without requesting permission.
- [ ] Any architecture/document links are accessible.
- [ ] README clearly states assumptions and limitations.
- [ ] No passwords, API keys, personal access tokens, or real secrets are committed.

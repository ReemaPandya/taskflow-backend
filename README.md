# TaskFlow Backend

Production-minded multi-tenant project-management backend for the GrubPac Technologies Backend Developer technical assignment.

## Stack

- Node.js 20 + TypeScript + Fastify
- PostgreSQL 16 + Prisma
- Redis 7 + BullMQ
- JWT access/refresh tokens + bcrypt (cost 12)
- Zod validation
- OpenAPI/Swagger UI + Postman collection
- Vitest unit/integration tests
- Docker Compose

## Quick start

```bash
cp .env.example .env
# Replace both JWT secrets before non-local use.
docker compose up --build -d

docker compose exec api node dist/prisma/seed.js
```

Open:

- API: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/docs`
- Health: `http://localhost:3000/health`

Seed logins:

- `admin@acme.test` / `Password123!`
- `admin@globex.test` / `Password123!`

## Architecture and code organization

The HTTP path is deliberately split into **Route → Controller → Service → Data**:

```text
src/modules/<feature>/
  *.routes.ts       route registration + middleware only
  *.controller.ts   HTTP parsing/status codes
  *.service.ts      business rules + tenant-safe data operations

src/lib/prisma.ts   PostgreSQL/Prisma data boundary
src/queues/         BullMQ + transactional-outbox dispatch
src/workers/        async email worker + outbox relay
```

`ARCHITECTURE.md` documents the tenant boundary, auth lifecycle, queue consistency strategy, delete behavior, and indexes.

## Tenant isolation

Normal project/task APIs never accept `org_id` as authorization input. The access token carries a selected organization context, and `authenticate` rechecks `(org_id, user_id)` against `org_members` on every protected request. Service queries then use `request.auth.orgId` or a relation filter back to that organization.

For single-resource access, a tenant-scoped lookup is attempted first. If the UUID exists but belongs to another organization, TaskFlow returns:

```json
{
  "error": "Forbidden",
  "code": "FORBIDDEN",
  "details": {}
}
```

No foreign resource fields are serialized.

## Authentication

Public auth endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`

All four are limited to **10 requests/minute/IP**.

Security behavior:

- bcrypt cost factor 12
- access JWT: 15 minutes
- refresh JWT: 7 days
- refresh tokens stored only as SHA-256 hashes
- revocation supported
- refresh-token rotation is single-use and transactionally revokes the old token
- bonus `POST /auth/logout-all` revokes all active refresh tokens for the authenticated user/organization

Registration creates a new organization and makes the registrant `org_admin`. A user can later belong to multiple organizations. `organizationId` may be supplied only during login to choose a context; membership is validated before a token is issued.

## Organization members

- `GET /organization/members`
- `POST /organization/members` — admin
- `PATCH /organization/members/:userId` — admin role management
- `DELETE /organization/members/:userId` — admin

## Projects

- `GET /projects?page=1&limit=20`
- `POST /projects`
- `GET /projects/:id`
- `PATCH /projects/:id`
- `DELETE /projects/:id` — admin; soft delete
- `GET /projects/:id/dashboard` — task counts grouped by status

Offset-list responses use:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 20
}
```

## Tasks

- `GET /projects/:projectId/tasks`
- `POST /projects/:projectId/tasks`
- `GET /tasks/:id`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id` — soft delete
- `POST /tasks/bulk-status` — bonus
- `GET /tasks/search?q=...` — PostgreSQL full-text search bonus
- `POST /tasks/:taskId/assignments`
- `DELETE /tasks/:taskId/assignments/:userId`
- `GET /tasks/:taskId/comments`
- `POST /tasks/:taskId/comments`

Task list filters:

- `status`
- `priority`
- `assignee`
- `dueFrom`
- `dueTo`
- `page`
- `limit`

All bodies, IDs, enums, date filters, and pagination inputs are Zod-validated.

## Assignment notification consistency

PostgreSQL and Redis cannot share an ACID transaction, so the implementation uses a **transactional outbox** instead of pretending the dual write is atomic.

Assignment flow:

1. A Redis key provides the optional 5-second `(task,user)` dedupe guard.
2. PostgreSQL transaction validates the task tenant and assignee membership.
3. The transaction inserts `task_assignments` and `notification_outbox` together.
4. After commit, the API attempts to enqueue the BullMQ job using a deterministic outbox-based job ID.
5. A **2xx response is returned only if BullMQ enqueue succeeds**, satisfying the assignment requirement.
6. If enqueue fails, the API returns `503 NOTIFICATION_ENQUEUE_PENDING`; the assignment is still consistent because its notification intent is durably stored as `pending` in the same database transaction.
7. The worker has an outbox relay that retries pending outbox rows after Redis recovers. Repeated dispatch is safe because BullMQ receives the same custom job ID.

This design avoids the two dangerous cases:

- assignment committed with no durable notification intent
- email sent for a database transaction that never committed

## Worker, retries and dead-letter queue

The email worker is asynchronous and uses a mock sender, so no third-party secret is required.

Queue policy:

- first attempt + **3 retries** (`attempts: 4`)
- exponential backoff with base 1s: approximately **1s → 2s → 4s**
- global BullMQ limiter: **50 emails/minute**
- exhausted jobs are dead-lettered to `taskflow-email-dlq`
- the original failed BullMQ record is retained so `/jobs/:id` can immediately report `failed`
- durable outbox audit preserves terminal `completed`/`failed` status even if BullMQ later trims old completed jobs

To demo the retry/DLQ path, assign a user whose email contains `+fail`, such as `worker+fail@example.com`. The mock sender intentionally throws for that address.

## Job status

`GET /jobs/:id` returns a tenant-protected normalized status:

- `pending`
- `active`
- `completed`
- `failed`

It also includes job ID, attempt information, failure reason, limited metadata, and timestamps. Job ownership is checked against the server-generated organization ID stored in the job/outbox; a user from another tenant receives 403.

## Database design

Required tables:

- `users`
- `organizations`
- `org_members`
- `projects`
- `tasks`
- `task_assignments`
- `comments`

Additional production-support tables:

- `refresh_tokens`
- `notification_outbox`

PostgreSQL enums:

- task status: `todo`, `in_progress`, `review`, `done`
- priority: `low`, `medium`, `high`, `urgent`
- organization role: `org_admin`, `member`
- outbox status: `pending`, `enqueued`, `completed`, `failed`

### Foreign-key decisions

- Organization → Project: **RESTRICT** so deleting an organization cannot silently erase project history.
- Project → Task: **CASCADE** for explicit hard-delete/maintenance; normal API deletion uses `deleted_at`.
- Task → Assignment/Comment: **CASCADE** because those rows have no meaning without the task.
- User → Comment: **RESTRICT** to preserve authorship.
- Assignment → Outbox: **SET NULL** so a committed notification event remains auditable after later unassignment.
- User/Organization → memberships/tokens: lifecycle **CASCADE** where appropriate.

### Indexes

Migration comments explain the query each index supports. Included indexes cover:

- tenant project lists
- task status/priority filtering
- due-date filtering
- assignee lookups
- ordered comments
- active refresh tokens
- outbox relay/audit scans
- GIN PostgreSQL full-text search over task title + description

## Migrations

Forward migration:

`prisma/migrations/202608230001_init/migration.sql`

A matching `down.sql` is supplied for explicit local rollback/documentation. Prisma itself favors forward corrective migrations for production rollbacks.

## Seed data

`prisma/seed.ts` creates:

- 2 organizations
- 5 users
- 3 projects
- 12 tasks distributed across projects
- all task statuses/priorities
- assignments
- comments

Run locally:

```bash
npm run db:seed
```

## Tests

Unit tests cover:

- bcrypt cost + access-token tenant claims
- real assignment tenant validation helper
- pagination helper

Integration tests cover:

- login flow
- task CRUD
- validation errors
- cross-tenant project access → 403
- task assignment → BullMQ job creation

The integration suite uses a dedicated test PostgreSQL database and Redis database, truncating/flushing state before each test.

Start test dependencies:

```bash
cp .env.test.example .env.test
docker compose --profile test up -d postgres-test redis-test
```

Wait until they are healthy, then:

```bash
DATABASE_URL=postgresql://taskflow:taskflow@localhost:5433/taskflow_test?schema=public npx prisma migrate deploy
npm run test:integration
```

Unit tests:

```bash
npm test
```

Unit coverage:

```bash
npm run test:coverage
```

Full coverage after starting the test PostgreSQL/Redis services:

```bash
npm run test:coverage:all
```

## Local development without containerizing API/worker

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Second terminal:

```bash
npm run worker:dev
```

PostgreSQL and Redis must match `.env`.

## API documentation

- Swagger UI: `/docs`
- Source OpenAPI document: `openapi.yaml`
- Importable collection: `TaskFlow.postman_collection.json`

The Postman collection automatically stores the login tokens, resolves a seeded organization member, creates a project/task, stores their IDs, assigns the member, and stores the returned job ID. It therefore does not require editing request IDs by hand after importing and seeding the database.

## Security / secrets

- `.env` and `.env.test` are gitignored.
- Only example environment files are committed.
- No email/API credentials are necessary because email is mocked.
- Passwords are never returned.
- Refresh tokens are stored hashed.
- Cross-tenant responses never return the foreign resource body.

## Assumptions / limitations

- Email sending is intentionally mocked for the assignment.
- User email is globally unique; users may belong to multiple organizations.
- PostgreSQL full-text search uses English text configuration.
- The API requires Redis for assignment requests because the assignment workflow promises a queued notification on successful responses.
- A future production version would add tracing/metrics, a real mail adapter, external secret management, CI migration checks, and alerting for DLQ growth.

## Submission files

- `README.md`
- `ARCHITECTURE.md`
- `openapi.yaml`
- `TaskFlow.postman_collection.json`
- `DEMO_SCRIPT.md`

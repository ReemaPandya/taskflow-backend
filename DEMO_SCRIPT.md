# TaskFlow Demo Script (4–5 minutes)

## 0:00–0:30 — Intro

“Hi, this is my TaskFlow backend submission. It is a multi-tenant project management API built with Node.js, TypeScript, Fastify, PostgreSQL, Prisma, Redis, BullMQ, Zod, JWT authentication, and Docker Compose.”

Show the repository root and `docker-compose.yml`.

## 0:30–1:00 — Start and architecture

Run:

```bash
docker compose up --build -d
docker compose ps
```

Open `ARCHITECTURE.md` and briefly show the API → PostgreSQL and API → BullMQ → worker paths.

## 1:00–1:40 — Authentication

Open `http://localhost:3000/docs`.

Call `POST /auth/login` using:

```json
{
  "email": "admin@acme.test",
  "password": "Password123!"
}
```

Copy the access token. Mention bcrypt cost 12, 15-minute access JWT, 7-day persisted refresh token, refresh rotation, and 10 requests/minute/IP rate limiting.

## 1:40–2:30 — Projects, tasks, filters and dashboard

Authorize Swagger with the bearer token.

- `GET /projects`
- Pick a project and call `GET /projects/{id}/tasks?status=todo&priority=high`
- Create a task with `POST /projects/{projectId}/tasks`
- Call `GET /projects/{id}/dashboard`
- Optionally show `GET /tasks/search?q=backend` for PostgreSQL full-text search.

## 2:30–3:10 — Tenant isolation

Login as `admin@globex.test / Password123!` in a second tab. Copy a project ID from Acme and request it with the Globex token.

Show the response:

```json
{
  "error": "Forbidden",
  "code": "FORBIDDEN",
  "details": {}
}
```

Explain that `org_id` is never trusted from the client; middleware derives tenant context from authenticated membership and service queries are scoped by that tenant.

## 3:10–4:00 — Assignment queue / worker

Return to the Acme token. Use `GET /organization/members` to copy a member ID, then call:

`POST /tasks/{taskId}/assignments`

```json
{ "userId": "<member-id>" }
```

Show the returned `jobId`. In a terminal run:

```bash
docker compose logs -f worker
```

Show the mock email completion, then call `GET /jobs/{jobId}` and show `completed`.

Mention that the assignment + notification intent are committed together through the transactional outbox, a 2xx is returned only after BullMQ accepts the job, the 5-second dedupe key prevents rapid duplicates, and the worker uses three retries with 1s/2s/4s exponential backoff, a 50 emails/minute limit, and a DLQ after exhaustion.

## 4:00–4:30 — Tests

Show:

```bash
npm test
npm run test:integration
```

Point out login, task CRUD, validation, cross-tenant 403, pagination, auth primitives, and the queue-job integration test.

## 4:30–4:50 — Close

“Those are the main design decisions. The README documents setup, assumptions, security choices, schema/index rationale, and the PostgreSQL/Redis consistency tradeoff. Thanks for reviewing my submission.”

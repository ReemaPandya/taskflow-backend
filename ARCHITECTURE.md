# TaskFlow Architecture

## 1. Component view

```text
Client / Swagger / Postman
           |
           v
+---------------------------+
| Fastify API               |
| Route -> Controller       |
|       -> Service          |
+-------------+-------------+
              |
       authenticated tenant context
              |
       +------+---------------------+
       |                            |
       v                            v
+--------------+             +-------------+
| PostgreSQL   |             | Redis       |
| Prisma       |             | BullMQ      |
|              |             +------+------+
| assignment   |                    |
| + outbox     |                    v
+--------------+             +-------------+
       ^                     | Email Worker|
       |                     | + outbox    |
       +---------------------|   relay     |
                             +-------------+
```

## 2. Route → Controller → Service → Data

Routes register paths and middleware only. Controllers translate HTTP input/output and run Zod validation. Services own business/authorization rules. Prisma is the PostgreSQL data boundary, while queue modules are the asynchronous data boundary.

This keeps HTTP concerns out of business logic and makes service-level tenancy behavior explicit.

## 3. Multi-tenant boundary

The client does not supply `org_id` to authorize project/task operations.

```text
Authorization: Bearer <access JWT>
              |
              v
verify JWT signature/expiry
              |
              v
read {userId, orgId, role}
              |
              v
recheck (orgId,userId) in org_members
              |
              v
request.auth
              |
              v
service queries scoped to orgId
```

A global lookup is used only as an authorization probe after a tenant-scoped miss so the API can distinguish “not found” from “existing but foreign.” Foreign resource fields are never returned.

## 4. Authentication lifecycle

### Login/register

- bcrypt cost factor 12
- access JWT: 15 minutes
- refresh JWT: 7 days
- SHA-256 hash of refresh token stored in PostgreSQL

### Refresh rotation

The refresh endpoint verifies the JWT and DB record, then transactionally:

1. rechecks current organization membership
2. revokes the old token only if `revoked_at IS NULL`
3. issues and persists a new refresh-token hash

The conditional update makes a refresh token single-use under concurrent replay.

## 5. Assignment + notification consistency

A direct PostgreSQL write followed by a Redis write is not atomic. TaskFlow uses a transactional outbox.

```text
POST /tasks/:id/assignments
           |
           v
Redis 5s NX dedupe guard
           |
           v
PostgreSQL transaction
   - verify task tenant
   - verify assignee membership
   - insert task_assignment
   - insert notification_outbox(status=pending)
           |
         COMMIT
           |
           v
attempt deterministic BullMQ enqueue
           |
      +----+-----+
      |          |
    success    failure
      |          |
      v          v
outbox=enqueued  outbox remains pending
return 2xx       return 503 (not success)
                 |
                 v
          worker outbox relay retries
```

A successful HTTP response therefore means both the assignment is durable and BullMQ accepted the notification job. If Redis fails after the database transaction, notification intent is not lost; the API returns a non-success status and the outbox relay retries.

The BullMQ custom job ID is derived from the outbox UUID. Re-dispatching the same pending event is therefore idempotent at the queue boundary.

## 6. Worker lifecycle

The worker:

1. verifies the durable outbox event exists and belongs to the job organization
2. performs mock email delivery
3. updates outbox audit status on completion/final failure
4. runs a small periodic relay for pending outbox rows

Queue policy:

- one initial attempt + 3 retries
- exponential backoff base 1s
- global limit 50 jobs/minute
- final failures copied to `taskflow-email-dlq`
- original failed job retained for BullMQ job-state inspection
- outbox audit retains terminal status if BullMQ later trims old jobs

## 7. Job status tenancy

Every queue payload receives `orgId` on the server; it does not come from client assignment input. `/jobs/:id` compares this value against the authenticated organization before exposing metadata. If a queue record has already been trimmed, the same check is performed against the durable outbox row.

## 8. Delete behavior

- Project API deletion: soft delete (`deleted_at`).
- Task API deletion: soft delete (`deleted_at`).
- Organization → Project FK: `RESTRICT`.
- Project → Task FK: `CASCADE` only for explicit hard-delete maintenance.
- Task → assignments/comments: `CASCADE`.
- User → comments: `RESTRICT`.
- Assignment → outbox: `SET NULL` so the committed event remains auditable after unassignment.

## 9. Index strategy

- projects `(org_id, deleted_at)` — tenant project list
- projects `(org_id, created_at)` — tenant chronological list
- tasks `(project_id, status, deleted_at)` — status filter
- tasks `(project_id, priority, deleted_at)` — priority filter
- tasks `due_date` — range filter
- assignments `(user_id, assigned_at)` — assignee filter
- comments `(task_id, created_at)` — task comment timeline
- refresh tokens `(user_id, org_id, revoked_at)` — revoke/active-token operations
- outbox `(status, created_at)` — relay pending work
- outbox `(org_id, created_at)` — tenant audit lookup
- GIN `to_tsvector(title || description)` — PostgreSQL full-text search

## 10. Production next steps

For a larger deployment I would add OpenTelemetry tracing, Prometheus metrics, DLQ alerts, a real email-provider adapter, secret-manager integration, CI migration validation, structured audit logging, and cursor pagination for very large task tables.

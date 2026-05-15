# Agent Operating Guide

This file is for LLM coding agents working in this repository. Read it before
making deployment, environment, or database changes.

## Environments And Branches

- Production branch: `prd`.
- Staging branch: `stg`.
- If this clone or the server is still on an older branch such as `v2`, stop and
  confirm the intended branch before deploying.
- Production app path on the server: the checked-out repo root.
- Production app is run with Docker Compose.
- Production app ports: frontend `3000`, backend `4000`.
- Local development should default to the staging database, not production.

## Local Database Workflow

- Use `npm run db:tunnel` to open an SSH tunnel from local `localhost:5433` to
  the server PostgreSQL port.
- Keep the tunnel terminal open while running the local backend.
- Use `npm run db:use:stg` for normal local testing.
- Use `npm run db:use:prd` only for careful production debugging where writes are
  not expected.
- The active backend env file is `be/.env`.
- Local-only env profile files such as `be/.env.stg.local` and
  `be/.env.prd.local` are intentionally ignored by git and must never be
  committed.

## Production Safety Rules

- Never run destructive commands against the production database by default.
- Destructive actions include `DROP`, `TRUNCATE`, bulk `DELETE`, bulk `UPDATE`,
  `prisma migrate reset`, `prisma db push --force-reset`, restoring over
  production, or any migration that may remove/overwrite production data.
- Even if the user asks for a destructive production DB action, pause and get
  explicit confirmation twice before proceeding.
- The confirmation must name the exact target database, the action, and the
  latest backup file that will be used for rollback.
- Do not print secrets, passwords, or full connection strings in chat, commits,
  logs, docs, or PR descriptions.

## Production DB Backup Rule

Before any production database migration or production data-changing maintenance:

1. SSH to the server.
2. Go to the checked-out repo root.
3. Create a timestamped dump in the repo-local `backups/` folder.
4. Verify the dump file exists and has a non-zero size.
5. Only then run the migration.

Example backup pattern:

```bash
cd <repo-root>
mkdir -p backups
TS=$(date -u +%Y%m%dT%H%M%SZ)
sudo docker run --rm \
  --network subs-postgres_default \
  --env-file .env \
  -v "$PWD/backups:/backups" \
  postgres:16 \
  sh -eu -c 'pg_dump --no-owner --no-acl -Fc "$DATABASE_URL" -f "/backups/subs_prod_before_migration_'"$TS"'.dump"'
ls -lh "backups/subs_prod_before_migration_$TS.dump"
```

## Staging DB Refresh

- Staging database name: `subs_stg`.
- Production database name: `subs_prod`.
- Refreshing staging from production is allowed only when the user asks for it.
- A staging refresh may drop/recreate `subs_stg`, but must never drop/recreate
  `subs_prod`.
- Before refreshing staging, create a production dump in the repo-local
  `backups/` folder and restore that dump into `subs_stg`.
- After refresh, verify table counts or key model counts match between
  `subs_prod` and `subs_stg`.

## Production Deployment Checklist

1. Confirm the target branch is `prd`.
2. Check server git status and do not overwrite unrelated server-local changes.
3. Pull using fast-forward only.
4. Rebuild and restart with Docker Compose.
5. Run health checks.
6. Report the deployed commit hash and health-check result.

Example deployment flow:

```bash
ssh <server-user>@<server-host>
cd <repo-root>
git status --short
git fetch origin
git checkout prd
git pull --ff-only origin prd
sudo docker compose up -d --build
sudo docker compose ps
curl -fsS http://localhost:4000/health
curl -I -fsS http://localhost:3000
git log --oneline -1
```

If the server is not on `prd`, or if `prd` does not exist yet, stop and confirm
the branch migration plan with the user before deploying.

## Migration Checklist

1. Confirm whether the migration targets `stg` or `prd`.
2. For `prd`, create and verify a backup first.
3. Review the migration SQL for destructive statements.
4. Run migrations through the app's normal Prisma migration flow.
5. Verify the app starts and the API health check passes.
6. For production, keep the backup filename in the final report.

Useful commands:

```bash
cd be
npm run db:deploy
npm run build
```

Do not use `prisma migrate reset` or force-reset commands against production.

# Membership monorepo

- **be** – Node.js + Express API (Prisma, PostgreSQL)
- **fe** – Next.js 14 (TypeScript, shadcn/ui, Lucide)

Database name: `membership_db`.

## Backend (be)

1. Create PostgreSQL DB: `createdb membership_db`
2. Copy env and set `DATABASE_URL`:
   ```bash
   cd be && cp .env.example .env
   # Edit .env: DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/membership_db"
   ```
3. Install and setup:
   ```bash
   npm install
   npx prisma generate
   npm run db:migrate
   npx prisma db seed
   ```
4. Run: `npm run dev` (port 4000)

Seed creates super user: **super@example.com** / **admin123**

## Local server database profiles

Local development can use the server PostgreSQL through an SSH tunnel. By default, use
the staging database so test writes do not touch production data.

1. Open the tunnel in one terminal:
   ```bash
   npm run db:tunnel
   ```
2. Choose the backend DB profile:
   ```bash
   npm run db:use:stg
   ```
3. Run the app in another terminal:
   ```bash
   npm run dev
   ```

Use `npm run db:use:prd` only for production debugging where writes are not expected.
Both profiles connect through `localhost:5433`; the selected database name in
`be/.env` decides whether the backend uses `subs_stg` or `subs_prod`.

## Frontend (fe)

1. From repo root or `fe`:
   ```bash
   cd fe && npm install
   ```
2. Run: `npm run dev` (port 3000)

Set `NEXT_PUBLIC_API_URL=http://localhost:4000` in `fe/.env.local` if the API is elsewhere.

## Docker (Digital Ocean)

Uses **Neon** for PostgreSQL. Create a project at [neon.tech](https://neon.tech) and copy the connection string.

1. On your droplet, install Docker and Docker Compose.
2. Copy env and set your values:
   ```bash
   cp .env.example .env
   # Edit .env:
   #   DATABASE_URL=<your-neon-connection-string>
   #   NEXT_PUBLIC_API_URL=http://YOUR_DROPLET_IP:4000
   #   FE_ORIGIN=http://YOUR_DROPLET_IP:3000
   #   JWT_SECRET=<strong-secret>
   ```
3. Build and run:
   ```bash
   docker compose up -d --build
   ```
   The backend container applies committed Prisma migrations automatically on startup.
4. Seed the database (optional):
   ```bash
   docker compose exec be npx prisma db seed
   ```
5. App: http://YOUR_DROPLET_IP:3000, API: http://YOUR_DROPLET_IP:4000

## Roles

- **super_user**: Manage organizations; create users for any org; access all data.
- **admin**: Manage users for their organization; create/edit memberships and persons.
- **user**: Create/edit memberships and persons only.

Admin and user must be assigned to an organization. Super user has no organization.

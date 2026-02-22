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
   npx prisma db push
   npx prisma db seed
   ```
4. Run: `npm run dev` (port 4000)

Seed creates super user: **super@example.com** / **admin123**

## Frontend (fe)

1. From repo root or `fe`:
   ```bash
   cd fe && npm install
   ```
2. Run: `npm run dev` (port 3000)

Set `NEXT_PUBLIC_API_URL=http://localhost:4000` in `fe/.env.local` if the API is elsewhere.

## Roles

- **super_user**: Manage organizations; create users for any org; access all data.
- **admin**: Manage users for their organization; create/edit memberships and persons.
- **user**: Create/edit memberships and persons only.

Admin and user must be assigned to an organization. Super user has no organization.

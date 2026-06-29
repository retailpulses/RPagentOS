# Retailpulses Agent OS Core

Shop4 promotion decision MVP — minimum core database and development framework for automated listing analysis, promotion candidate generation, agent decision, human review, and execution logging.

## Prerequisites

- Node.js >= 18
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- Docker Desktop (required by `supabase start`)

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Start local Supabase
supabase start

# 3. Create local environment file (DO NOT commit)
cp .env.example .env.local

# 4. Get the local service_role key
supabase status

# 5. Copy the service_role key into .env.local
#    SUPABASE_SERVICE_ROLE_KEY=<value from supabase status>

# 6. Apply migrations and seed data
npm run db:reset

# 7. Run the connection test
npm run test:supabase
```

## MVP mock flow

### v1 — basic flow (legacy)

```bash
npm run db:reset
npm run flow:mock
npm run test:supabase
```

### v2 — with agent_runs / run_id tracing (recommended)

```bash
npm run db:reset
npm run flow:mock:v2
npm run test:supabase
```

## Data import

Import sample listings (upsert) before running the flow:

```bash
npm run db:reset
npm run job:import-listings:json
npm run flow:mock:v2
```

The import is idempotent — it upserts by `spu_code` (products), `sku` (variants), and
`platform+shop_code+external_listing_id` (listings). No real platform API is called.
The flow only generates candidates for listings with `listing_status=active`,
`stock_qty > 0`, and `current_price` not null.

### Validate-before-write

Each row is **fully validated before any write**. Required fields: `spu_code`,
`product_title`, `sku`, `platform`, `shop_code`, `external_listing_id`,
`listing_title`, `listing_status`, `current_price` (number >= 0),
`stock_qty` (integer >= 0). If validation fails, the row is recorded in
`import_errors` and no products, variants, or listings are written for it.
This prevents orphan products or partial dirty data.

Each import run creates an `agent_run` with `run_type=listing_import_json`. Row-level
failures are recorded in the `import_errors` table for audit, without breaking the
rest of the import.

### Error test

```bash
npm run job:import-listings:json:error-test
```

This imports from `data/sample-shop4-listings-with-error.json`, which contains 2 valid
rows and 1 row intentionally missing a `sku`. The valid rows are imported normally;
the bad row is recorded in `import_errors` without blocking the other rows.

## Recommended workflow

```bash
npm run db:reset             # Reset local DB (seed: 1 product, 1 variant, 1 listing)
npm run job:import-listings:json  # Upsert sample listings (2 more listings from JSON)
npm run flow:mock:v2         # Run the full mock pipeline
```

Individual job scripts:

| Command | Description |
|---|---|
| `npm run job:import-listings:json` | Upsert products/variants/listings from a JSON file |
| `npm run job:import-listings:json:error-test` | Same as above, using the error-test data file |
| `npm run job:generate-candidates` | Create promotion candidates from active mercari/shop4 listings |
| `npm run job:mock-decision` | Generate mock agent decisions for pending candidates |
| `npm run job:approve` | Approve the first pending candidate |
| `npm run job:execute-mock` | Create mock execution logs for approved candidates |

## Scripts

| Command | Description |
|---|---|
| `npm run flow:mock` | (v1) Run the full mock pipeline: candidates → decision → approval → execution |
| `npm run flow:mock:v2` | (v2) Same pipeline with run_id tracing via agent_runs table |
| `npm run job:import-listings:json` | Upsert product/variant/listing data from a local JSON file |
| `npm run job:import-listings:json:error-test` | Test import with intentionally bad rows |
| `npm run test:supabase` | Test Supabase connection and query mercari/shop4 listings |
| `npm run db:reset` | Reset local DB, apply all migrations, run seed.sql |
| `npm run db:push` | Push migrations to linked remote project |
| `npm run db:status` | Show Supabase local status |

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` has full admin access.
- Never commit `.env.local` or any file containing real keys to git.
- The `.env.local` file is ignored by `.gitignore`.

## Schema status

Current schema is **v1 — initial version**. It will evolve as features are added. See `supabase/migrations/` for the full DDL.

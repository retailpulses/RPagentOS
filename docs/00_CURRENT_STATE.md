# Current State

## Production

| Item | Value |
|------|-------|
| Production URL | `https://agent.homesbliss.net` |
| Staging URL | <!-- URL(s) for staging --> |
| Database | <!-- e.g. Supabase project ref --> |
| Frontend | React SPA deployed on Cloudflare Pages |
| Backend | Cloudflare Pages Functions with server-side Supabase access |

## Account Metrics MVP

- `/metrics` shows complete-month KPIs, trends, monthly history, and deterministic management signals for active platform accounts.
- The default “All Mercari Shops” view combines shop1–shop4 only for months where every shop has exactly one valid complete metric row. Additive KPIs are summed; CVR and purchase value are derived from combined totals.
- Partial periods are displayed as provisional context but excluded from month-over-month comparisons and signal generation.
- The browser calls the same-origin public read-only `/api/account-metrics` Pages Function; the Supabase `service_role` credential remains server-side.
- “Plan task” and “Start project” prefill the existing forms with account and signal context. A manager must review and submit them manually; the dashboard performs no marketplace action.

## Known Limitations

- Account metrics are visible to anyone who can access `agent.homesbliss.net`; per-user authorization is not implemented.
- Metrics are refreshed from imported monthly source files; the MVP does not fetch Mercari analytics automatically.

## Next Milestone

<!-- The next major goal for this project -->

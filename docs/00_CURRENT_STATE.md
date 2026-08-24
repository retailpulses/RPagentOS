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
- Partial periods are displayed as provisional context but excluded from month-over-month comparisons and signal generation.
- The browser calls the same-origin `/api/account-metrics` Pages Function with a dedicated manager token kept in `sessionStorage`; the Supabase `service_role` credential remains server-side.
- “Plan task” and “Start project” prefill the existing forms with account and signal context. A manager must review and submit them manually; the dashboard performs no marketplace action.

## Known Limitations

- Dashboard access uses one shared manager bearer token rather than per-user authentication and authorization.
- Metrics are refreshed from imported monthly source files; the MVP does not fetch Mercari analytics automatically.

## Next Milestone

<!-- The next major goal for this project -->

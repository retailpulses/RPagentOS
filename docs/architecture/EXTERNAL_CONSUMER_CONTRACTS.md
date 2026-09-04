# RPagentOS External Consumer Contracts

Status: initial audit, 2026-09-04
Tracking: #104

## Purpose

This document is the safety map for RPagentOS-owned shared domains. It records known external consumers before any squeeze, retirement, extraction, repository merge, or ownership migration.

Safe-change rule:

> No owned object or contract with an external consumer may be renamed, removed, privilege-changed, or moved until the consumer has a compatible replacement, migration evidence, and rollback path.

## Current architectural boundary

RPagentOS currently plays two distinct roles:

1. **Shared-domain owner** — schema/migrations and owner-side contracts, especially `product_catalog`.
2. **Agent OS application** — UI, task/project workflows, listing intelligence/quality and related application features.

The shared-domain role is ACTIVE/STABLE. The Agent OS application role is being frozen from feature expansion under #103. This audit does not authorize any production contract change.

## Critical dependency matrix

| Consumer / workload | RPagentOS-owned domain | Contract / object | Access | Production criticality | Evidence / notes | Current recommendation |
|---|---|---|---|---|---|---|
| CatalogSync Mercari shops 1–3 full + priority reconciliation | `product_catalog` | `catalogsync_mercari_listing_map_v1`, `catalogsync_mercari_catalog_v1`; per-shop reader roles/Auth identities | read-only PostgREST | P0 | CatalogSync runtime config directly names these views; jobs reconcile marketplace quantity/state | **DO NOT BREAK** |
| CatalogSync Mercari shop4 full + priority reconciliation | `product_catalog` | `catalogsync_mercari_shop4_listing_map_v1`, `catalogsync_mercari_shop4_catalog_v1`; `catalogsync_shop4_reader` | read-only PostgREST | P0 | Separate shop4 projections preserved by current governance | **DO NOT BREAK** |
| CatalogSync Amazon inventory sync | `product_catalog` | `catalogsync_marketplace_projection_v1`; `catalogsync_marketplace_reader` | read-only PostgREST / CatalogSync projection adapter | P0 | CatalogSync job inventory identifies this projection as source for Amazon marketplace writes | **DO NOT BREAK** |
| CatalogSync Rakuten inventory sync | `product_catalog` | `catalogsync_marketplace_projection_v1`; dedicated/shared reader identity | read-only PostgREST | P0 | Same projection feeds Rakuten inventory path; current governance allows direct VPS consumer | **DO NOT BREAK** |
| CatalogSync Giga → Mercari listing pipeline | `product_catalog` | authenticated RPagentOS catalog-owner API routes | owner-mediated bounded write + readback | P0 | CatalogSync governance prohibits direct DB write and requires owner API for source import/listing-state mutations | **DO NOT BREAK** |
| CatalogSync weekly Mercari orphan mapping reconciliation | `product_catalog` | RPagentOS listing-state owner API | owner-mediated bounded write | P0/P1 | Repairs mapping state; ambiguity/incomplete reads fail closed | **DO NOT BREAK** |
| ticket-handling | `product_catalog` | products, variants, platform listings/SKUs/accounts and shared remote migration representation | shared-domain consumption | P1 | Ticket governance declares product catalog consumption for ticket association and seller-share snapshots | Preserve; verify runtime access path |
| ticket-handling | `project_management` | `projects`, `project_attachments` | shared-domain consumption | P1 | Ticket governance explicitly declares RPagentOS as owner; ticket repo also contains historical/shared migration definitions | Preserve; ownership history needs reconciliation |
| ticket-handling | `task_management` | `tasks` | shared-domain consumption | P1 | Used for ticket linking | Preserve; verify runtime access path |
| ticket-handling | `listing_quality` | `listing_review_schedule_status_v1` | read/shared view | P1/P2 | Explicitly declared in ticket governance; ticket repo contains shared migration representation | Preserve until listing-quality disposition decided |

## CatalogSync P0 contracts — DO NOT BREAK

The following are production-sensitive and must be treated as compatibility contracts, not RPagentOS-internal implementation details:

### Mercari projections

- `catalogsync_mercari_listing_map_v1`
- `catalogsync_mercari_catalog_v1`
- `catalogsync_mercari_shop4_listing_map_v1`
- `catalogsync_mercari_shop4_catalog_v1`
- `catalogsync_shop1_reader`
- `catalogsync_shop2_reader`
- `catalogsync_shop3_reader`
- `catalogsync_shop4_reader`
- associated Supabase Auth workload identity → reader-role mappings

CatalogSync code and job inventory directly reference these views. Removing or renaming them can stop Mercari reconciliation.

### Amazon / Rakuten marketplace projection

- `catalogsync_marketplace_projection_v1`
- `catalogsync_marketplace_reader`
- associated approved Auth identities and SELECT grant

CatalogSync's projection repository fixes this view name as an approved resource and applies freshness/bounded-query behavior around it. Amazon and Rakuten jobs consume it for marketplace synchronization.

### Owner-mediated write APIs

CatalogSync governance explicitly prohibits CatalogSync from owning shared Product Catalog schema or directly writing the base tables for governed workloads. Existing RPagentOS catalog-owner/listing-state APIs therefore form a P0 write boundary, not optional convenience endpoints.

Before any API retirement, identify every concrete route/caller and provide a compatible owner-side replacement.

## ticket-handling shared-domain dependency

Ticket Handling is a confirmed external consumer beyond CatalogSync. Its governance declaration currently consumes:

- `product_catalog` — products, variants, platform listings/SKUs/accounts
- `project_management` — projects, project attachments
- `listing_quality` — listing review schedule status view
- `task_management` — tasks

### Ownership-history warning

The ticket-handling repository contains migration files that create or represent objects now declared as RPagentOS-owned (for example project-management and listing-quality objects), as well as `shared_remote` migrations recording RPagentOS-owned Product Catalog changes.

This is a **governance/history drift signal**, not authorization to change ownership. Before moving or retiring these domains, reconcile:

1. which repo is canonical migration owner today;
2. which migrations are historical mirrors/shared-remote records versus active ownership;
3. whether ticket-handling runtime accesses base tables, generated types, views, or APIs;
4. whether any deployment process could still attempt to apply historical definitions.

Until reconciled, preserve the objects.

## Current owned-domain disposition (initial)

| Domain | Current role | External consumer evidence | Near-term disposition |
|---|---|---|---|
| `product_catalog` | canonical shared commerce/catalog data | Strong: CatalogSync P0; ticket-handling P1 | **KEEP / ACTIVE-STABLE** |
| `agent_os` | agent runs/decisions/approvals/execution logs | No external consumer confirmed in this initial pass | **FREEZE; investigate** |
| `task_management` | tasks and task workflow | ticket-handling consumes `tasks` | **FREEZE; preserve contract** |
| `project_management` | projects/attachments | ticket-handling consumes | **FREEZE; preserve; reconcile ownership history** |
| `listing_intelligence` | listing intelligence runs/results/work items | No external consumer confirmed in this initial pass | **FREEZE; investigate** |
| `listing_quality` | listing review/review scheduling | ticket-handling consumes schedule-status view | **FREEZE; preserve contract** |

`No external consumer confirmed` means only that this audit has not found one yet. It does **not** mean the domain is safe to delete.

## Access-boundary principles to preserve

For Product Catalog consumers:

- consumer repos should not gain migration ownership merely because they execute business workloads;
- CatalogSync must not receive `service_role` or unrestricted base-table write access;
- read consumers should use narrow approved projections/roles where practical;
- shared-domain writes should remain owner-mediated and bounded;
- schema changes require explicit consumer-impact review;
- production contract removal requires migration + rollback evidence.

## Known unknowns / follow-up audit

1. Enumerate exact RPagentOS owner API routes currently called by CatalogSync and map them to scripts/jobs.
2. Verify live status of Mercari shop1–3 projections versus governance statuses/documentation; historical docs have contained pending/active transitions.
3. Verify whether any consumer still uses legacy `product_mercari_qty_vw` or other older projections alongside the newer views.
4. Reconcile ticket-handling migration history for `project_management` and `listing_quality` with current RPagentOS ownership declarations.
5. Search remaining business repos for direct table names, Supabase generated types, RPagentOS API hostnames, and shared-domain references that generic code search may miss.
6. Identify whether `agent_os` and `listing_intelligence` have production/background consumers outside the RPagentOS web application.
7. Record concrete kill switches and runtime locations for every P0 owner-mediated write contract.

## Change protocol

Before changing an RPagentOS-owned externally consumed object:

1. identify all consumers from this matrix and repository search;
2. classify production/business criticality;
3. add replacement contract without removing the old one;
4. migrate/canary the consumer;
5. verify readback/business behavior;
6. retain rollback path;
7. only then deprecate/remove the old contract in a separate change.

This document should be updated whenever a new external consumer or shared-domain contract is introduced.
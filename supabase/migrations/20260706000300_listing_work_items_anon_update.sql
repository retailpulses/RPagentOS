-- Ensure the no-RLS MVP-0 workbench can update listing work item status from the
-- deployed browser client, including cloud projects where 20260706000200 was
-- applied manually before the anon update grant was added locally.

grant select, update on listing_work_items to anon;

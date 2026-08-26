-- Per-category icon key for the storefront Shop-by-Category bar (dairy/oil/honey/
-- grain/spice/leaf). NULL = auto-pick from the category name. Additive & idempotent.
alter table public.categories add column if not exists icon text;

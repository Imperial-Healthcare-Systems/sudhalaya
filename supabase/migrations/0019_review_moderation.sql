-- Suddhalaya — hold new reviews for admin approval (client QA r2).
--
-- The `approved` column + RLS (public reads only approved; staff manage all) already
-- exist from 0001/0002. The only change needed: new reviews must default to NOT approved
-- so they are held for moderation instead of appearing immediately. Existing rows keep
-- their current value (so already-approved reviews stay visible).
-- Additive + idempotent + forward-only.

alter table public.product_reviews alter column approved set default false;
alter table public.home_reviews    alter column approved set default false;

comment on column public.product_reviews.approved is
  'Admin moderation gate. New reviews default false (held); public RLS shows only approved.';
comment on column public.home_reviews.approved is
  'Admin moderation gate. New reviews default false (held); public RLS shows only approved.';

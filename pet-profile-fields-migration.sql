-- Ejecutar en Supabase SQL Editor si la base ya fue creada con una version anterior del esquema.
alter table public.pets
  add column if not exists additional_description text,
  add column if not exists public_owner_phone boolean not null default false,
  add column if not exists public_last_seen boolean not null default true,
  add column if not exists public_vaccines_visible boolean not null default true;

alter table public.pets
  alter column public_last_seen set default false,
  alter column public_vaccines_visible set default false;

drop view if exists public.public_pet_profiles;

create view public.public_pet_profiles
with (security_invoker = false)
as
select
  p.id as pet_id,
  p.name,
  p.species,
  p.breed,
  p.size,
  p.sex,
  p.temperament,
  p.additional_description,
  p.public_last_seen,
  case when p.public_last_seen then p.last_seen_place end as last_seen_place,
  p.status,
  case when p.public_diseases then p.diseases end as public_diseases,
  case when p.public_heart_problems then p.heart_problems end as public_heart_problems,
  case when p.public_allergies then p.allergies end as public_allergies,
  case when p.public_vaccines_visible then p.vaccines end as public_vaccines,
  p.public_vaccines_visible,
  case when p.public_owner_phone then o.phone end as owner_phone,
  p.photo_path,
  q.public_token
from public.pets p
join public.owners o on o.id = p.owner_id
join public.qr_tags q on q.pet_id = p.id and q.is_active
where p.status in ('lost', 'active', 'reunited');

grant select on public.public_pet_profiles to anon, authenticated;

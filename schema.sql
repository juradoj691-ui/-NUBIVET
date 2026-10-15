-- NUBIVET: esquema inicial para un proyecto Supabase nuevo.
-- Ejecutar una vez en Supabase > SQL Editor. No insertar datos de ejemplo.

create extension if not exists pgcrypto;

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_nubivet_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  full_name varchar(120) not null,
  email varchar(255),
  phone varchar(40) not null,
  address_label varchar(255) not null,
  location_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners(id) on delete cascade,
  name varchar(100) not null,
  species varchar(40) not null check (species in ('Perro', 'Gato', 'Otro')),
  breed varchar(100),
  size varchar(10) not null check (size in ('small', 'medium', 'large')),
  sex varchar(30),
  temperament varchar(40),
  additional_description text,
  public_owner_phone boolean not null default false,
  public_last_seen boolean not null default false,
  last_seen_place varchar(255) not null default '',
  status varchar(20) not null default 'lost' check (status in ('active', 'lost', 'reunited', 'inactive')),
  photo_path text,
  diseases text,
  public_diseases boolean not null default false,
  heart_problems text,
  public_heart_problems boolean not null default false,
  allergies text,
  public_allergies boolean not null default false,
  medications text,
  public_vaccines_visible boolean not null default false,
  vaccines text,
  clinical_history text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.qr_tags (
  id uuid primary key default gen_random_uuid(),
  pet_id uuid not null unique references public.pets(id) on delete cascade,
  public_token uuid not null unique default gen_random_uuid(),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.publication_requests (
  id uuid primary key default gen_random_uuid(),
  owner_name varchar(120) not null,
  owner_phone varchar(40) not null,
  pet_name varchar(100),
  last_seen_place varchar(255),
  details text,
  status varchar(20) not null default 'pending'
    check (status in ('pending', 'contacted', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table public.app_settings (
  setting_key varchar(80) primary key,
  setting_value text not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (setting_key, setting_value)
values ('public_contact_phone', '+591 700 00000');

create index pets_owner_id_idx on public.pets(owner_id);
create index pets_status_idx on public.pets(status);
create index publication_requests_status_idx on public.publication_requests(status);

-- La vista expone únicamente datos aprobados para el perfil QR público.
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

alter table public.admin_users enable row level security;
alter table public.owners enable row level security;
alter table public.pets enable row level security;
alter table public.qr_tags enable row level security;
alter table public.publication_requests enable row level security;
alter table public.app_settings enable row level security;

create policy "Admins can read their own admin record"
on public.admin_users for select to authenticated
using (user_id = (select auth.uid()));

create policy "Admins manage owners"
on public.owners for all to authenticated
using ((select public.is_nubivet_admin()))
with check ((select public.is_nubivet_admin()));

create policy "Admins manage pets"
on public.pets for all to authenticated
using ((select public.is_nubivet_admin()))
with check ((select public.is_nubivet_admin()));

create policy "Admins manage QR tags"
on public.qr_tags for all to authenticated
using ((select public.is_nubivet_admin()))
with check ((select public.is_nubivet_admin()));

create policy "Public can request a publication"
on public.publication_requests for insert to anon, authenticated
with check (status = 'pending' and reviewed_at is null);

create policy "Admins manage publication requests"
on public.publication_requests for all to authenticated
using ((select public.is_nubivet_admin()))
with check ((select public.is_nubivet_admin()));

create policy "Public can read contact number"
on public.app_settings for select to anon, authenticated
using (setting_key in ('public_contact_phone', 'public_cover_photo_path'));

create policy "Admins update contact settings"
on public.app_settings for all to authenticated
using ((select public.is_nubivet_admin()))
with check ((select public.is_nubivet_admin()));

grant select on public.public_pet_profiles to anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, update, delete on public.owners, public.pets, public.qr_tags to authenticated;
grant select, update, delete on public.publication_requests to authenticated;
grant insert, update on public.app_settings to authenticated;
grant insert (owner_name, owner_phone, pet_name, last_seen_place, details)
on public.publication_requests to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pet-photos', 'pet-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

create policy "Anyone can view published pet photos"
on storage.objects for select to anon, authenticated
using (bucket_id = 'pet-photos');

create policy "Admins upload pet photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pet-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_nubivet_admin())
);

create policy "Admins update pet photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'pet-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_nubivet_admin())
)
with check (
  bucket_id = 'pet-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_nubivet_admin())
);

create policy "Admins delete pet photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'pet-photos'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select public.is_nubivet_admin())
);

-- Después de crear el primer usuario en Authentication > Users, ejecutar:
-- insert into public.admin_users (user_id)
-- values ('UUID_DEL_USUARIO_CREADO_EN_AUTHENTICATION');

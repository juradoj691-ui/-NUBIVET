-- Ejecutar una vez en proyectos Supabase ya configurados para permitir la portada pública.
drop policy if exists "Public can read contact number" on public.app_settings;

create policy "Public can read contact number"
on public.app_settings for select to anon, authenticated
using (setting_key in ('public_contact_phone', 'public_cover_photo_path'));

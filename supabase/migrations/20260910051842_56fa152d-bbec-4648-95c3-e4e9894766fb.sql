ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS miasto text,
  ADD COLUMN IF NOT EXISTS kategoria text,
  ADD COLUMN IF NOT EXISTS godziny text,
  ADD COLUMN IF NOT EXISTS mapy_url text,
  ADD COLUMN IF NOT EXISTS opis text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS nip text,
  ADD COLUMN IF NOT EXISTS regon text,
  ADD COLUMN IF NOT EXISTS wlasciciel text,
  ADD COLUMN IF NOT EXISTS social text,
  ADD COLUMN IF NOT EXISTS dane_wzbogacone_at timestamp with time zone;
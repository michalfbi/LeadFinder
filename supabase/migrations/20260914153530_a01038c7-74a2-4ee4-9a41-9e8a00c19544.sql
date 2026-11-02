ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS imie text,
  ADD COLUMN IF NOT EXISTS plec text;
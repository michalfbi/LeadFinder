ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'nowy';
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads (status);
CREATE POLICY "Public can update leads" ON public.leads FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
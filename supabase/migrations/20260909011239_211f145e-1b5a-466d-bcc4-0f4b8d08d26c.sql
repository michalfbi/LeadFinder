CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nazwa TEXT NOT NULL,
  ocena NUMERIC,
  liczba_opinii INTEGER,
  adres TEXT,
  telefon TEXT,
  zrodlo TEXT NOT NULL DEFAULT 'Google Maps',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read leads" ON public.leads FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can insert leads" ON public.leads FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Public can delete leads" ON public.leads FOR DELETE TO anon, authenticated USING (true);
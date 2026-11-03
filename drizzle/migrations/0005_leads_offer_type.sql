ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS offer_type text; CREATE INDEX IF NOT EXISTS leads_offer_type_idx ON public.leads (offer_type);

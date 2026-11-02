ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS telefon_status text,
  ADD COLUMN IF NOT EXISTS engaged_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deal_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_template_id text,
  ADD COLUMN IF NOT EXISTS sms_combination_signature text,
  ADD COLUMN IF NOT EXISTS sms_exact_text text;
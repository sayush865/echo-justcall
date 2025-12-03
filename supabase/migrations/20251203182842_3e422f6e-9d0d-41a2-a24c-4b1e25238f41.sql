-- Create dynamic_suggestions table for AI-generated suggestion pills
CREATE TABLE public.dynamic_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL means global suggestion
  label text NOT NULL, -- Short display text for the pill
  prompt text NOT NULL, -- Detailed prompt to send to chat
  category text NOT NULL DEFAULT 'general', -- e.g., "churn", "feature", "integration", "trend"
  icon text, -- Icon name (e.g., "Lightbulb", "AlertTriangle")
  priority integer NOT NULL DEFAULT 0, -- For ordering suggestions
  metadata jsonb DEFAULT '{}'::jsonb, -- Additional context
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '12 hours'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for fast lookups
CREATE INDEX idx_dynamic_suggestions_user_id ON public.dynamic_suggestions(user_id);
CREATE INDEX idx_dynamic_suggestions_active ON public.dynamic_suggestions(is_active, expires_at);
CREATE INDEX idx_dynamic_suggestions_global ON public.dynamic_suggestions(user_id) WHERE user_id IS NULL;

-- Enable RLS
ALTER TABLE public.dynamic_suggestions ENABLE ROW LEVEL SECURITY;

-- Users can read their own personalized suggestions
CREATE POLICY "Users can view their own suggestions"
ON public.dynamic_suggestions
FOR SELECT
USING (auth.uid() = user_id);

-- Users can read global suggestions (where user_id is NULL)
CREATE POLICY "Users can view global suggestions"
ON public.dynamic_suggestions
FOR SELECT
USING (user_id IS NULL AND is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- Allow edge function to manage suggestions (using service role)
CREATE POLICY "Service role can manage all suggestions"
ON public.dynamic_suggestions
FOR ALL
USING (true)
WITH CHECK (true);
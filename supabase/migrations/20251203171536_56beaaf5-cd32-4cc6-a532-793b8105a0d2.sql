-- Add login tracking columns to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS login_count integer DEFAULT 0;

-- Note: last_sign_in column already exists based on the schema
-- Create index for activity tracking
CREATE INDEX IF NOT EXISTS idx_profiles_last_sign_in ON public.profiles(last_sign_in);
CREATE INDEX IF NOT EXISTS idx_profiles_login_count ON public.profiles(login_count);
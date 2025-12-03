-- Add follow_up_suggestions column to messages table to persist follow-ups
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS follow_up_suggestions jsonb DEFAULT '[]'::jsonb;
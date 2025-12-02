-- Add pinned column for pinning conversations
ALTER TABLE public.conversations 
ADD COLUMN pinned boolean NOT NULL DEFAULT false;
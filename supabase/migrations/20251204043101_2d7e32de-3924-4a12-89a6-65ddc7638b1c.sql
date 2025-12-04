-- Add pending_response column to track conversations with AI responses in progress
ALTER TABLE public.conversations ADD COLUMN pending_response boolean DEFAULT false;
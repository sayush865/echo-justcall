-- Add user_email column to messages table
ALTER TABLE public.messages ADD COLUMN user_email text;

-- Add user_id column to messages table for direct user reference
ALTER TABLE public.messages ADD COLUMN user_id uuid;

-- Create index for faster lookups by user
CREATE INDEX idx_messages_user_email ON public.messages(user_email);
CREATE INDEX idx_messages_user_id ON public.messages(user_id);
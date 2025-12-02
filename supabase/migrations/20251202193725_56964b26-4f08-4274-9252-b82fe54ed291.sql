-- Add status column for soft delete
ALTER TABLE public.conversations 
ADD COLUMN status text NOT NULL DEFAULT 'active';

-- Create index for faster filtering
CREATE INDEX idx_conversations_status ON public.conversations(status);
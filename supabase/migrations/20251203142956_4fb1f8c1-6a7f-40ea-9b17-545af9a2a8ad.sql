-- Create conversation_shares table
CREATE TABLE public.conversation_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  share_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz DEFAULT NULL,
  is_active boolean NOT NULL DEFAULT true
);

-- Enable RLS
ALTER TABLE public.conversation_shares ENABLE ROW LEVEL SECURITY;

-- Policy: Users can create shares for their own conversations
CREATE POLICY "Users can create shares for their conversations"
ON public.conversation_shares FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.conversations
    WHERE conversations.id = conversation_shares.conversation_id
    AND conversations.user_id = auth.uid()
  )
);

-- Policy: Users can view their own shares
CREATE POLICY "Users can view their own shares"
ON public.conversation_shares FOR SELECT
TO authenticated
USING (created_by = auth.uid());

-- Policy: Users can update their own shares (to revoke/change expiry)
CREATE POLICY "Users can update their own shares"
ON public.conversation_shares FOR UPDATE
TO authenticated
USING (created_by = auth.uid());

-- Policy: Users can delete their own shares
CREATE POLICY "Users can delete their own shares"
ON public.conversation_shares FOR DELETE
TO authenticated
USING (created_by = auth.uid());

-- Policy: Anyone can look up active, non-expired shares by token (for public access)
CREATE POLICY "Public can lookup active shares"
ON public.conversation_shares FOR SELECT
TO anon, authenticated
USING (
  is_active = true 
  AND (expires_at IS NULL OR expires_at > now())
);

-- Add policy for public to view shared conversations
CREATE POLICY "Public can view shared conversations"
ON public.conversations FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversation_shares
    WHERE conversation_shares.conversation_id = conversations.id
    AND conversation_shares.is_active = true
    AND (conversation_shares.expires_at IS NULL OR conversation_shares.expires_at > now())
  )
);

-- Add policy for public to view messages in shared conversations
CREATE POLICY "Public can view messages in shared conversations"
ON public.messages FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.conversation_shares
    WHERE conversation_shares.conversation_id = messages.conversation_id
    AND conversation_shares.is_active = true
    AND (conversation_shares.expires_at IS NULL OR conversation_shares.expires_at > now())
  )
);
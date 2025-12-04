-- Add RLS policy for public read access to conversation_shares by token
CREATE POLICY "Anyone can read active shares by token"
ON public.conversation_shares
FOR SELECT
USING (is_active = true);

-- Add RLS policy for reading conversations via share
CREATE POLICY "Anyone can read shared conversations"
ON public.conversations
FOR SELECT
USING (
  id IN (
    SELECT conversation_id FROM public.conversation_shares
    WHERE is_active = true
  )
);

-- Add RLS policy for reading messages via share
CREATE POLICY "Anyone can read messages of shared conversations"
ON public.messages
FOR SELECT
USING (
  conversation_id IN (
    SELECT conversation_id FROM public.conversation_shares
    WHERE is_active = true
  )
);
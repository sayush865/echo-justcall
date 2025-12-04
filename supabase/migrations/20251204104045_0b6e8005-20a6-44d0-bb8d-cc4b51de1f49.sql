-- Add UPDATE policy for messages so users can update follow_up_suggestions
CREATE POLICY "Users can update messages in their conversations"
ON public.messages
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.id = messages.conversation_id
    AND conversations.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.id = messages.conversation_id
    AND conversations.user_id = auth.uid()
  )
);
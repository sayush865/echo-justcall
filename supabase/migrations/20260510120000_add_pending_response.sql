-- Track whether a streaming AI response is in progress for a conversation.
-- Used by the chat edge function and useBackgroundContinuation hook to resume
-- in-flight streams when the client reconnects.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_response BOOLEAN DEFAULT false;

-- Add indexes for frequently queried columns to improve performance

-- Index for messages by conversation and creation time (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
ON public.messages(conversation_id, created_at);

-- Index for active dynamic suggestions (filtered query)
CREATE INDEX IF NOT EXISTS idx_dynamic_suggestions_active_user 
ON public.dynamic_suggestions(user_id, is_active, expires_at) 
WHERE is_active = true;

-- Index for global suggestions (null user_id)
CREATE INDEX IF NOT EXISTS idx_dynamic_suggestions_global 
ON public.dynamic_suggestions(is_active, priority DESC) 
WHERE user_id IS NULL AND is_active = true;

-- Index for conversation shares by token (lookup)
CREATE INDEX IF NOT EXISTS idx_conversation_shares_token 
ON public.conversation_shares(share_token) 
WHERE is_active = true;

-- Index for audit logs by conversation (admin queries)
CREATE INDEX IF NOT EXISTS idx_audit_logs_conversation 
ON public.audit_logs(conversation_id, created_at DESC);

-- Index for conversations by user (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated 
ON public.conversations(user_id, updated_at DESC) 
WHERE status = 'active';
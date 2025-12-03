-- Create audit_logs table for developer visibility
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  event_type text NOT NULL, -- 'user_message', 'ai_response', 'conversation_created', 'auth_event', etc.
  message_content text,
  ai_response text,
  metadata jsonb DEFAULT '{}'::jsonb, -- For storing additional data like tokens, latency, etc.
  ip_address text,
  user_agent text
);

-- Create index for faster queries
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_conversation_id ON public.audit_logs(conversation_id);
CREATE INDEX idx_audit_logs_event_type ON public.audit_logs(event_type);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- Enable RLS but allow service role full access (for edge functions)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only allow authenticated users to view their own logs (optional - can be admin-only)
CREATE POLICY "Users can view their own audit logs"
ON public.audit_logs
FOR SELECT
USING (auth.uid() = user_id);

-- Allow inserts from authenticated users and service role
CREATE POLICY "Allow inserts for logging"
ON public.audit_logs
FOR INSERT
WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.audit_logs IS 'Developer audit log for tracking all user interactions, messages, and AI responses';
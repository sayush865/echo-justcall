-- Drop the overly permissive INSERT policy
DROP POLICY IF EXISTS "Allow inserts for logging" ON public.audit_logs;

-- Create a new policy that only allows service role to insert
-- Edge functions use service_role key, so they can still insert
-- But anonymous/authenticated users cannot insert directly
CREATE POLICY "Only service role can insert audit logs"
ON public.audit_logs
FOR INSERT
TO service_role
WITH CHECK (true);
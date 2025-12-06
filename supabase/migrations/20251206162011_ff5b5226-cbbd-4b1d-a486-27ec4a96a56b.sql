-- Create user_feedback table
CREATE TABLE public.user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  display_name text,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  feedback_text text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

-- Anyone can submit feedback (even anonymous)
CREATE POLICY "Anyone can insert feedback"
ON public.user_feedback
FOR INSERT
WITH CHECK (true);

-- Users can view their own feedback
CREATE POLICY "Users can view their own feedback"
ON public.user_feedback
FOR SELECT
USING (auth.uid() = user_id);

-- Admins can view all feedback
CREATE POLICY "Admins can view all feedback"
ON public.user_feedback
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));
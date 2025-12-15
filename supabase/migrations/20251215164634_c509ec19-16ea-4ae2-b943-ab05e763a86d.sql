-- Create blocked_ips table
CREATE TABLE public.blocked_ips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address TEXT NOT NULL,
  reason TEXT,
  blocked_by UUID REFERENCES auth.users(id),
  blocked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(ip_address)
);

-- Enable RLS
ALTER TABLE public.blocked_ips ENABLE ROW LEVEL SECURITY;

-- Only admins can view blocked IPs
CREATE POLICY "Admins can view blocked IPs"
ON public.blocked_ips
FOR SELECT
USING (has_role(auth.uid(), 'admin'));

-- Only admins can insert blocked IPs
CREATE POLICY "Admins can insert blocked IPs"
ON public.blocked_ips
FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Only admins can update blocked IPs
CREATE POLICY "Admins can update blocked IPs"
ON public.blocked_ips
FOR UPDATE
USING (has_role(auth.uid(), 'admin'));

-- Only admins can delete blocked IPs
CREATE POLICY "Admins can delete blocked IPs"
ON public.blocked_ips
FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- Create index for quick IP lookups
CREATE INDEX idx_blocked_ips_active ON public.blocked_ips(ip_address, is_active) WHERE is_active = true;
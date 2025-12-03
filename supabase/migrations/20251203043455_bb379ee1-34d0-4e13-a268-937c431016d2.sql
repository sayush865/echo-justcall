-- Add last_sign_in column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN last_sign_in timestamp with time zone;
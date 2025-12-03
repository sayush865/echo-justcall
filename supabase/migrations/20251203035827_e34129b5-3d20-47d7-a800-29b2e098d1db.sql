-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for profiles
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Trigger for auto-creating profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (new.id, new.email, new.raw_user_meta_data ->> 'display_name');
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Update conversations to link to authenticated users
DROP POLICY IF EXISTS "Anyone can create conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anyone can delete conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anyone can update conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anyone can view conversations" ON public.conversations;

CREATE POLICY "Users can view their own conversations"
ON public.conversations FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own conversations"
ON public.conversations FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own conversations"
ON public.conversations FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations"
ON public.conversations FOR DELETE
USING (auth.uid() = user_id);

-- Update messages policies to work via conversation ownership
DROP POLICY IF EXISTS "Anyone can create messages" ON public.messages;
DROP POLICY IF EXISTS "Anyone can delete messages" ON public.messages;
DROP POLICY IF EXISTS "Anyone can view messages" ON public.messages;

CREATE POLICY "Users can view messages in their conversations"
ON public.messages FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.conversations 
  WHERE conversations.id = messages.conversation_id 
  AND conversations.user_id = auth.uid()
));

CREATE POLICY "Users can create messages in their conversations"
ON public.messages FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.conversations 
  WHERE conversations.id = messages.conversation_id 
  AND conversations.user_id = auth.uid()
));

CREATE POLICY "Users can delete messages in their conversations"
ON public.messages FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.conversations 
  WHERE conversations.id = messages.conversation_id 
  AND conversations.user_id = auth.uid()
));
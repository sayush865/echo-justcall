-- Enable realtime for messages table so new messages appear instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
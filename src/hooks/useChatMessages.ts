import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { FollowUpSuggestion } from "@/types/chat";

// Use a simpler Message type for internal use that accepts the Supabase response
interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
  follow_up_suggestions?: { label: string; prompt: string }[] | null;
}

interface UseChatMessagesOptions {
  conversationId: string | null;
  activeConversationRef: React.MutableRefObject<string | null>;
}

export const useChatMessages = ({ conversationId, activeConversationRef }: UseChatMessagesOptions) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestion[]>([]);
  const messagesCacheRef = useRef<Map<string, { messages: Message[]; followUps: FollowUpSuggestion[] }>>(new Map());

  const loadMessages = useCallback(async (isBackgroundRefresh = false) => {
    if (!conversationId) return;

    if (!isBackgroundRefresh) {
      setMessagesLoading(true);
    }

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    // Only update if still on same conversation
    if (activeConversationRef.current !== conversationId) return;

    setMessagesLoading(false);

    if (error) {
      toast.error("Failed to load messages");
      return;
    }

    // Map to internal Message type
    const loadedMessages: Message[] = (data || []).map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      follow_up_suggestions: Array.isArray(m.follow_up_suggestions) 
        ? m.follow_up_suggestions as { label: string; prompt: string }[]
        : undefined,
    }));
    
    let followUps: FollowUpSuggestion[] = [];
    
    // Load follow-up suggestions from the last assistant message
    const lastAssistantMsg = [...loadedMessages].reverse().find(m => m.role === "assistant");
    if (lastAssistantMsg?.follow_up_suggestions && Array.isArray(lastAssistantMsg.follow_up_suggestions)) {
      followUps = lastAssistantMsg.follow_up_suggestions;
    }

    // Update cache
    messagesCacheRef.current.set(conversationId, { messages: loadedMessages, followUps });
    
    setMessages(loadedMessages);
    setFollowUpSuggestions(followUps);
  }, [conversationId, activeConversationRef]);

  const addOptimisticMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setFollowUpSuggestions([]);
  }, []);

  const getCachedData = useCallback((convId: string) => {
    return messagesCacheRef.current.get(convId);
  }, []);

  const updateCache = useCallback((convId: string, data: { messages?: Message[]; followUps?: FollowUpSuggestion[] }) => {
    const existing = messagesCacheRef.current.get(convId) || { messages: [], followUps: [] };
    messagesCacheRef.current.set(convId, {
      messages: data.messages ?? existing.messages,
      followUps: data.followUps ?? existing.followUps,
    });
  }, []);

  // Setup realtime subscription
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          // Only update if still viewing this conversation
          if (activeConversationRef.current === conversationId) {
            loadMessages(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, activeConversationRef, loadMessages]);

  return {
    messages,
    setMessages,
    messagesLoading,
    followUpSuggestions,
    setFollowUpSuggestions,
    loadMessages,
    addOptimisticMessage,
    clearMessages,
    getCachedData,
    updateCache,
    messagesCacheRef,
  };
};

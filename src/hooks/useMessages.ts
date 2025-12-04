import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface UseMessagesOptions {
  conversationId: string | null;
  onError?: (error: string) => void;
}

// Global cache that persists across component remounts
const globalMessagesCache = new Map<string, { 
  messages: Message[]; 
  followUps: {label: string; prompt: string}[];
  timestamp: number;
}>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const useMessages = ({ conversationId, onError }: UseMessagesOptions) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<{label: string; prompt: string}[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const activeConversationRef = useRef<string | null>(null);

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
      onError?.("Failed to load messages");
      return;
    }

    const loadedMessages = data || [];
    let followUps: {label: string; prompt: string}[] = [];
    
    // Load follow-up suggestions from the last assistant message
    const lastAssistantMsg = [...loadedMessages].reverse().find(m => m.role === "assistant");
    if (lastAssistantMsg?.follow_up_suggestions && Array.isArray(lastAssistantMsg.follow_up_suggestions)) {
      followUps = lastAssistantMsg.follow_up_suggestions as {label: string; prompt: string}[];
    }

    // Update global cache
    globalMessagesCache.set(conversationId, { 
      messages: loadedMessages, 
      followUps,
      timestamp: Date.now()
    });
    
    setMessages(loadedMessages);
    setFollowUpSuggestions(followUps);
  }, [conversationId, onError]);

  const addOptimisticMessage = useCallback((message: Omit<Message, 'id' | 'created_at'>) => {
    const tempId = `temp-${Date.now()}`;
    const newMessage: Message = {
      id: tempId,
      ...message,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, newMessage]);
    return tempId;
  }, []);

  const updateCache = useCallback((conversationId: string, newMessages: Message[], newFollowUps?: {label: string; prompt: string}[]) => {
    const existing = globalMessagesCache.get(conversationId);
    globalMessagesCache.set(conversationId, {
      messages: newMessages,
      followUps: newFollowUps ?? existing?.followUps ?? [],
      timestamp: Date.now()
    });
  }, []);

  // Initialize and subscribe to changes
  useEffect(() => {
    activeConversationRef.current = conversationId;

    if (conversationId) {
      // Check cache first for instant display
      const cached = globalMessagesCache.get(conversationId);
      const isCacheValid = cached && (Date.now() - cached.timestamp) < CACHE_TTL;
      
      if (isCacheValid) {
        setMessages(cached.messages);
        setFollowUpSuggestions(cached.followUps);
        // Still refresh in background for any new messages
        loadMessages(true);
      } else {
        setMessages([]);
        setFollowUpSuggestions([]);
        loadMessages(false);
      }

      // Set up realtime subscription
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
    } else {
      setMessages([]);
      setFollowUpSuggestions([]);
    }
  }, [conversationId, loadMessages]);

  return {
    messages,
    setMessages,
    followUpSuggestions,
    setFollowUpSuggestions,
    messagesLoading,
    loadMessages,
    addOptimisticMessage,
    updateCache,
    activeConversationRef,
  };
};

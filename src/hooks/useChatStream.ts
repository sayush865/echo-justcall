import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { triggerHaptic } from "@/hooks/useHapticFeedback";

export interface StreamingMessage {
  role: "assistant";
  content: string;
  isStreaming: boolean;
  steps?: string[];
}

interface UseChatStreamOptions {
  conversationId: string | null;
  user: { id: string; email?: string } | null;
  onMessageSent?: (conversationId: string, userMessage: string) => void;
  onStreamComplete?: (conversationId: string, content: string, messageId?: string) => void;
  onError?: (error: { title: string; description?: string }) => void;
}

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getErrorMessage = (error: any, status?: number): { title: string; description?: string } => {
  if (status === 401) return { title: "Authentication required", description: "Please sign in again." };
  if (status === 403) return { title: "Permission denied", description: "You don't have permission to perform this action." };
  if (status === 429) return { title: "Too many requests", description: "Please wait a moment and try again." };
  if (status === 500) return { title: "Server error", description: "Our team has been notified." };
  if (status === 503) return { title: "Looks like Ayush is sleepy 😴", description: "The AI service is taking a nap. Give it a moment!" };
  if (error?.message?.includes("503") || error?.message?.includes("Service Unavailable")) {
    return { title: "Looks like Ayush is sleepy 😴", description: "The AI service is taking a nap. Give it a moment!" };
  }
  if (error?.message?.includes("RLS")) return { title: "Permission denied", description: "Please sign in again." };
  if (error?.message?.includes("network")) return { title: "Network error", description: "Check your connection and try again." };
  return { title: error?.message || "Something went wrong", description: "Please try again." };
};

export const useChatStream = ({
  conversationId,
  user,
  onMessageSent,
  onStreamComplete,
  onError,
}: UseChatStreamOptions) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const sendInProgressRef = useRef<string | null>(null);
  const lastSentMessageRef = useRef<{ content: string; timestamp: number } | null>(null);
  const activeConversationRef = useRef<string | null>(conversationId);

  // Update active conversation ref when it changes
  activeConversationRef.current = conversationId;

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const sendMessage = useCallback(async (
    messageToSend: string,
    authUser?: { id: string; email?: string }
  ): Promise<{ conversationId: string; content: string } | null> => {
    const effectiveUser = authUser || user;
    if (!messageToSend || loading || !effectiveUser) return null;
    
    // Prevent duplicate sends
    if (lastSentMessageRef.current && 
        lastSentMessageRef.current.content === messageToSend &&
        Date.now() - lastSentMessageRef.current.timestamp < 5000) {
      return null;
    }
    
    triggerHaptic("medium");
    setLoading(true);
    
    sendInProgressRef.current = conversationId || 'new';
    lastSentMessageRef.current = { content: messageToSend, timestamp: Date.now() };
    
    // Show streaming UI immediately
    isStreamingRef.current = true;
    setStreamingMessage({ role: "assistant", content: "", isStreaming: true, steps: [] });

    let currentConversationId = conversationId;
    let fullContent = "";

    try {
      // Create new conversation if needed
      if (!currentConversationId) {
        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({ title: messageToSend.slice(0, 50), user_id: effectiveUser.id })
          .select()
          .single();

        if (convError) throw convError;
        currentConversationId = newConv.id;
        navigate(`/c/${currentConversationId}`);
        
        // Log conversation creation
        await supabase.from("audit_logs").insert({
          user_id: effectiveUser.id,
          conversation_id: currentConversationId,
          event_type: "conversation_created",
          metadata: { title: messageToSend.slice(0, 50) },
        });
      }

      // Insert user message
      const { error: msgError } = await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "user",
        content: messageToSend,
        user_id: effectiveUser.id,
        user_email: effectiveUser.email,
      });

      if (msgError) throw msgError;

      onMessageSent?.(currentConversationId, messageToSend);

      // Stream response
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      abortControllerRef.current = new AbortController();
      
      const response = await fetch(`${supabaseUrl}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ message: messageToSend, conversationId: currentConversationId }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      const steps: string[] = [];
      let buffer = "";
      
      const isActiveConversation = () => activeConversationRef.current === currentConversationId;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const text = buffer + chunk;
        buffer = "";
        
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          if (i === lines.length - 1 && !text.endsWith('\n')) {
            buffer = line;
            continue;
          }

          try {
            const parsed = JSON.parse(line);
            
            if (parsed.type === "item" && parsed.content) {
              fullContent += parsed.content;
              if (isActiveConversation()) {
                setStreamingMessage({ 
                  role: "assistant", 
                  content: fullContent, 
                  isStreaming: true,
                  steps 
                });
              }
            } else if (parsed.type === "step" || parsed.type === "tool" || parsed.type === "thinking") {
              const stepText = parsed.text || parsed.name || parsed.content || JSON.stringify(parsed);
              steps.push(stepText);
              if (isActiveConversation()) {
                setStreamingMessage(prev => prev ? { 
                  ...prev, 
                  steps: [...(prev.steps || []), stepText] 
                } : null);
              }
            } else if (parsed.type === "agent" && parsed.text) {
              steps.push(parsed.text);
              if (isActiveConversation()) {
                setStreamingMessage(prev => prev ? { 
                  ...prev, 
                  steps: [...(prev.steps || []), parsed.text] 
                } : null);
              }
            }
          } catch {
            // JSON parse failed
          }
        }
      }

      // Streaming complete
      if (isActiveConversation()) {
        setStreamingMessage({ role: "assistant", content: fullContent, isStreaming: false, steps });
      }

      // Save AI response
      const { data: insertedMsg } = await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: fullContent,
        user_id: effectiveUser.id,
        user_email: effectiveUser.email,
      }).select('id').single();

      if (isActiveConversation()) {
        setStreamingMessage(null);
      }

      onStreamComplete?.(currentConversationId, fullContent, insertedMsg?.id);

      return { conversationId: currentConversationId, content: fullContent };

    } catch (error: any) {
      // Handle abort
      if (error?.name === 'AbortError') {
        if (fullContent && currentConversationId) {
          // Save partial response
          const { data: insertedMsg } = await supabase.from("messages").insert({
            conversation_id: currentConversationId,
            role: "assistant",
            content: fullContent,
            user_id: effectiveUser.id,
            user_email: effectiveUser.email,
          }).select('id').single();
          
          onStreamComplete?.(currentConversationId, fullContent, insertedMsg?.id);
        }
        
        isStreamingRef.current = false;
        setStreamingMessage(null);
        setLoading(false);
        abortControllerRef.current = null;
        return null;
      }
      
      setStreamingMessage(null);
      const errorMsg = getErrorMessage(error, error?.status);
      
      // Handle retry logic
      if (retryCount < MAX_RETRIES && !error?.message?.includes("RLS") && !error?.message?.includes("401")) {
        const delay = INITIAL_DELAY * Math.pow(2, retryCount);
        setRetryCount(prev => prev + 1);
        onError?.({
          title: errorMsg.title,
          description: `${errorMsg.description || ''} Retrying in ${delay / 1000}s...`
        });
        await sleep(delay);
        return sendMessage(messageToSend, effectiveUser);
      }
      
      onError?.(errorMsg);
      return null;

    } finally {
      sendInProgressRef.current = null;
      isStreamingRef.current = false;
      setLoading(false);
      abortControllerRef.current = null;
      setRetryCount(0);
    }
  }, [conversationId, user, loading, retryCount, navigate, onMessageSent, onStreamComplete, onError]);

  return {
    loading,
    streamingMessage,
    setStreamingMessage,
    sendMessage,
    handleStop,
    isStreamingRef,
    sendInProgressRef,
  };
};

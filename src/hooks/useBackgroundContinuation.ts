import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { StreamingMessage, Message } from "@/types/chat";

interface UseBackgroundContinuationOptions {
  conversationId: string | null;
  activeConversationRef: React.MutableRefObject<string | null>;
  isStreamingRef: React.MutableRefObject<boolean>;
  streamingConversationIdRef: React.MutableRefObject<string | null>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  streamingMessage: StreamingMessage | null;
  setStreamingMessage: React.Dispatch<React.SetStateAction<StreamingMessage | null>>;
  setStreamingConversationId: React.Dispatch<React.SetStateAction<string | null>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  loadMessages: (isBackgroundRefresh?: boolean) => Promise<void>;
}

export const useBackgroundContinuation = ({
  conversationId,
  activeConversationRef,
  isStreamingRef,
  streamingConversationIdRef,
  abortControllerRef,
  streamingMessage,
  setStreamingMessage,
  setStreamingConversationId,
  setLoading,
  setMessages,
  loadMessages,
}: UseBackgroundContinuationOptions) => {
  const wasStreamingOnHideRef = useRef(false);
  const hiddenConversationRef = useRef<string | null>(null);
  const hiddenPartialContentRef = useRef<string>("");
  const pendingResponseCheckRef = useRef<string | null>(null);

  const checkPendingResponse = useCallback(async () => {
    if (!conversationId) return;
    
    // Skip if we're actively streaming to this conversation
    const isStreamingThisConversation = streamingConversationIdRef.current === conversationId;
    if (isStreamingThisConversation) return;
    
    const { data: conv } = await supabase
      .from("conversations")
      .select("pending_response")
      .eq("id", conversationId)
      .maybeSingle();
    
    if (conv?.pending_response && activeConversationRef.current === conversationId) {
      // Response is still processing in background - show loading indicator
      setLoading(true);
      isStreamingRef.current = true;
      streamingConversationIdRef.current = conversationId;
      setStreamingConversationId(conversationId);
      setStreamingMessage({ 
        role: "assistant", 
        content: "", 
        isStreaming: true, 
        steps: ["Resuming response..."] 
      });
      
      // Start polling for updates
      pollForUpdates(conversationId);
    }
  }, [conversationId, activeConversationRef, isStreamingRef, streamingConversationIdRef, setStreamingConversationId, setStreamingMessage, setLoading]);

  const pollForUpdates = useCallback(async (convId: string) => {
    if (activeConversationRef.current !== convId) return;
    
    const { data: updatedConv } = await supabase
      .from("conversations")
      .select("pending_response, streaming_content")
      .eq("id", convId)
      .maybeSingle();
    
    if (!updatedConv?.pending_response) {
      // Response completed - refresh messages
      await loadMessages(true);
      setStreamingMessage(null);
      setLoading(false);
      isStreamingRef.current = false;
      streamingConversationIdRef.current = null;
      setStreamingConversationId(null);
    } else {
      // Update streaming message with current progress
      if (updatedConv.streaming_content) {
        setStreamingMessage({
          role: "assistant",
          content: updatedConv.streaming_content,
          isStreaming: true,
          steps: ["Processing in background..."]
        });
      }
      // Still pending - check again in 500ms for live updates
      setTimeout(() => pollForUpdates(convId), 500);
    }
  }, [activeConversationRef, loadMessages, setStreamingMessage, setLoading, isStreamingRef, streamingConversationIdRef, setStreamingConversationId]);

  // Tab visibility handler
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden) {
        // Tab became hidden
        if (isStreamingRef.current && activeConversationRef.current) {
          wasStreamingOnHideRef.current = true;
          hiddenConversationRef.current = activeConversationRef.current;
          hiddenPartialContentRef.current = streamingMessage?.content || "";
          
          // Abort client-side stream - edge function continues in background
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }
          
          // Keep partial content visible
          if (hiddenPartialContentRef.current) {
            const tempId = `partial-hidden-${Date.now()}`;
            setMessages(prev => [...prev, {
              id: tempId,
              role: "assistant",
              content: hiddenPartialContentRef.current,
              created_at: new Date().toISOString()
            }]);
          }
          
          isStreamingRef.current = false;
          streamingConversationIdRef.current = null;
          setStreamingConversationId(null);
          setStreamingMessage(null);
          setLoading(false);
        }
      } else {
        // Tab became visible again
        if (wasStreamingOnHideRef.current && hiddenConversationRef.current) {
          const convToCheck = hiddenConversationRef.current;
          wasStreamingOnHideRef.current = false;
          hiddenConversationRef.current = null;
          
          if (activeConversationRef.current === convToCheck) {
            pendingResponseCheckRef.current = convToCheck;
            
            const { data: conv } = await supabase
              .from("conversations")
              .select("pending_response")
              .eq("id", convToCheck)
              .maybeSingle();
            
            if (conv?.pending_response) {
              setLoading(true);
              setStreamingMessage({ 
                role: "assistant", 
                content: hiddenPartialContentRef.current || "", 
                isStreaming: true, 
                steps: ["Resuming response..."] 
              });
              
              const checkComplete = async () => {
                const { data: updatedConv } = await supabase
                  .from("conversations")
                  .select("pending_response")
                  .eq("id", convToCheck)
                  .maybeSingle();
                
                if (!updatedConv?.pending_response) {
                  await loadMessages(true);
                  setStreamingMessage(null);
                  setLoading(false);
                  pendingResponseCheckRef.current = null;
                } else if (pendingResponseCheckRef.current === convToCheck) {
                  setTimeout(checkComplete, 1000);
                }
              };
              
              checkComplete();
            } else {
              await loadMessages(true);
              setStreamingMessage(null);
              setLoading(false);
            }
          }
          
          hiddenPartialContentRef.current = "";
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [streamingMessage, activeConversationRef, isStreamingRef, streamingConversationIdRef, abortControllerRef, setStreamingMessage, setStreamingConversationId, setLoading, setMessages, loadMessages]);

  return {
    checkPendingResponse,
    pollForUpdates,
  };
};

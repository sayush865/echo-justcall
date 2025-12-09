import { useState, useRef, useCallback } from "react";
import type { StreamingMessage } from "@/types/chat";
import type { PreloadedSource } from "@/lib/citationParser";

export const useChatStreaming = () => {
  const [loading, setLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [streamingSourceCount, setStreamingSourceCount] = useState(0);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  
  const isStreamingRef = useRef<boolean>(false);
  const streamingConversationIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toolSourceMapRef = useRef<Map<number, PreloadedSource>>(new Map());
  const preWarmFollowUpRef = useRef<Promise<any> | null>(null);

  const startStreaming = useCallback((conversationId: string | null) => {
    isStreamingRef.current = true;
    streamingConversationIdRef.current = conversationId || 'new';
    setStreamingConversationId(conversationId || 'new');
    setStreamingSourceCount(0);
    toolSourceMapRef.current = new Map();
    setStreamingMessage({ role: "assistant", content: "", isStreaming: true, steps: [] });
    setLoading(true);
    abortControllerRef.current = new AbortController();
  }, []);

  const stopStreaming = useCallback(() => {
    isStreamingRef.current = false;
    streamingConversationIdRef.current = null;
    setStreamingConversationId(null);
    setStreamingMessage(null);
    setLoading(false);
    abortControllerRef.current = null;
  }, []);

  const updateStreamingContent = useCallback((content: string, steps?: string[]) => {
    setStreamingMessage(prev => prev ? {
      ...prev,
      content,
      steps: steps || prev.steps,
    } : null);
  }, []);

  const finalizeStreaming = useCallback((content: string, steps: string[]) => {
    setStreamingMessage({ role: "assistant", content, isStreaming: false, steps });
  }, []);

  const abortStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  const resetForConversation = useCallback((conversationId: string | null, isSendingToThisConversation: boolean) => {
    const isStreamingThisConversation = streamingConversationIdRef.current === conversationId;
    
    if (!isStreamingThisConversation && !isSendingToThisConversation) {
      setLoading(false);
      setStreamingMessage(null);
      isStreamingRef.current = false;
    }
  }, []);

  return {
    loading,
    setLoading,
    streamingMessage,
    setStreamingMessage,
    streamingSourceCount,
    setStreamingSourceCount,
    streamingConversationId,
    isStreamingRef,
    streamingConversationIdRef,
    abortControllerRef,
    toolSourceMapRef,
    preWarmFollowUpRef,
    startStreaming,
    stopStreaming,
    updateStreamingContent,
    finalizeStreaming,
    abortStream,
    resetForConversation,
  };
};

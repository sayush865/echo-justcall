import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { FollowUpSuggestion } from "@/types/chat";

interface UseFollowUpsOptions {
  messagesCacheRef: React.MutableRefObject<Map<string, { messages: any[]; followUps: FollowUpSuggestion[] }>>;
  setFollowUpSuggestions: React.Dispatch<React.SetStateAction<FollowUpSuggestion[]>>;
}

export const useFollowUps = ({ messagesCacheRef, setFollowUpSuggestions }: UseFollowUpsOptions) => {
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const preWarmFollowUpRef = useRef<Promise<any> | null>(null);

  const startPreWarm = useCallback((userMessage: string) => {
    const preWarmStartTime = Date.now();
    preWarmFollowUpRef.current = supabase.functions.invoke('generate-followups', {
      body: { lastUserMessage: userMessage, userMessageOnly: true }
    }).then(res => ({ ...res, duration: Date.now() - preWarmStartTime, source: 'pre-warm' }))
      .catch(() => null);
  }, []);

  const generateFollowUps = useCallback(async (
    userMessage: string, 
    aiResponse: string, 
    conversationId: string,
    assistantMessageId?: string
  ) => {
    setFollowUpLoading(true);
    
    try {
      const fullContextStartTime = Date.now();
      const fullContextPromise = supabase.functions.invoke('generate-followups', {
        body: { 
          lastUserMessage: userMessage, 
          lastAIResponse: aiResponse.substring(0, 1500),
        }
      }).then(res => ({ ...res, duration: Date.now() - fullContextStartTime, source: 'full-context' }));
      
      // Race: Use pre-warmed if full-context takes >2s
      let result: any;
      let raceWinner: string;
      
      if (preWarmFollowUpRef.current) {
        const timeoutPromise = new Promise<any>(resolve => 
          setTimeout(async () => {
            const preWarm = await preWarmFollowUpRef.current;
            resolve(preWarm);
          }, 2000)
        );
        
        result = await Promise.race([
          fullContextPromise,
          timeoutPromise
        ]);
        raceWinner = result?.source || 'unknown';
      } else {
        result = await fullContextPromise;
        raceWinner = 'full-context';
      }
      
      const suggestions = result?.data?.suggestions || [];
      console.log(`[Follow-ups] Winner: ${raceWinner}, Count: ${suggestions.length}, Duration: ${result?.duration}ms`);
      
      setFollowUpSuggestions(suggestions);
      
      // Persist follow-ups to the assistant message
      if (assistantMessageId && suggestions.length > 0) {
        await supabase.from("messages")
          .update({ follow_up_suggestions: suggestions })
          .eq("id", assistantMessageId);
      }
      
      // Update cache
      if (conversationId && suggestions.length > 0) {
        const cached = messagesCacheRef.current.get(conversationId);
        if (cached) {
          messagesCacheRef.current.set(conversationId, {
            ...cached,
            followUps: suggestions
          });
        }
      }
      
      return suggestions;
    } catch (err) {
      console.error("Failed to generate follow-ups:", err);
      setFollowUpSuggestions([]);
      return [];
    } finally {
      setFollowUpLoading(false);
      preWarmFollowUpRef.current = null;
    }
  }, [messagesCacheRef, setFollowUpSuggestions]);

  const clearFollowUps = useCallback(() => {
    setFollowUpSuggestions([]);
  }, [setFollowUpSuggestions]);

  return {
    followUpLoading,
    setFollowUpLoading,
    startPreWarm,
    generateFollowUps,
    clearFollowUps,
    preWarmFollowUpRef,
  };
};

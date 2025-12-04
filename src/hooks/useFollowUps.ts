import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface UseFollowUpsOptions {
  onSuggestionsReady?: (suggestions: {label: string; prompt: string}[]) => void;
}

export const useFollowUps = ({ onSuggestionsReady }: UseFollowUpsOptions = {}) => {
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const generateFollowUps = useCallback(async (
    userMessage: string,
    aiResponse: string,
    conversationId: string,
    messageId?: string
  ) => {
    setFollowUpLoading(true);

    try {
      // Start user-only call during streaming for faster results
      const userOnlyPromise = supabase.functions.invoke('generate-followups', {
        body: { lastUserMessage: userMessage, userMessageOnly: true }
      }).then(({ data, error }) => ({ data, error, source: 'user-only' as const }))
        .catch(err => ({ data: null, error: err, source: 'user-only' as const }));

      // Full-context call (higher quality but slower)
      const fullContextPromise = supabase.functions.invoke('generate-followups', {
        body: { 
          lastUserMessage: userMessage, 
          lastAIResponse: aiResponse.substring(0, 1500),
        }
      }).then(({ data, error }) => ({ data, error, source: 'full-context' as const }))
        .catch(err => ({ data: null, error: err, source: 'full-context' as const }));

      // Race: Wait max 2 seconds for full-context
      const timeoutPromise = new Promise<{ timeout: true }>(resolve => 
        setTimeout(() => resolve({ timeout: true }), 2000)
      );

      const raceResult = await Promise.race([fullContextPromise, timeoutPromise]);
      
      let finalSuggestions: {label: string; prompt: string}[] = [];

      if ('timeout' in raceResult) {
        // Full-context took too long, use user-only result
        const userOnlyResult = await userOnlyPromise;
        if (userOnlyResult.data?.suggestions?.length > 0) {
          finalSuggestions = userOnlyResult.data.suggestions;
        }
        
        // Still wait for full-context and update if better
        fullContextPromise.then(async (result) => {
          if (result.data?.suggestions?.length > 0) {
            onSuggestionsReady?.(result.data.suggestions);
            
            // Persist better suggestions
            if (messageId) {
              await supabase
                .from("messages")
                .update({ follow_up_suggestions: result.data.suggestions })
                .eq("id", messageId);
            }
          }
        });
      } else {
        // Full-context arrived in time
        if (raceResult.data?.suggestions?.length > 0) {
          finalSuggestions = raceResult.data.suggestions;
        } else {
          // Full-context failed, try user-only
          const userOnlyResult = await userOnlyPromise;
          if (userOnlyResult.data?.suggestions?.length > 0) {
            finalSuggestions = userOnlyResult.data.suggestions;
          }
        }
      }

      onSuggestionsReady?.(finalSuggestions);
      
      // Persist follow-ups to message
      if (finalSuggestions.length > 0 && messageId) {
        await supabase
          .from("messages")
          .update({ follow_up_suggestions: finalSuggestions })
          .eq("id", messageId);
      }

      return finalSuggestions;

    } catch (error) {
      console.error("Failed to generate follow-ups:", error);
      return [];
    } finally {
      setFollowUpLoading(false);
    }
  }, [onSuggestionsReady]);

  return {
    followUpLoading,
    generateFollowUps,
  };
};

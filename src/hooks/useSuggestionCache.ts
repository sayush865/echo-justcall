import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Suggestion {
  id: string;
  label: string;
  prompt: string;
  category: string;
  icon: string | null;
  priority: number;
  user_id: string | null;
}

// Default suggestions as fallback
const defaultSuggestions: Omit<Suggestion, 'id'>[] = [
  {
    label: "Top Feature Requests",
    prompt: "What are the most requested features from customers this week? Include sentiment and which customer segments are asking for them.",
    category: "feature",
    icon: "Lightbulb",
    priority: 8,
    user_id: null,
  },
  {
    label: "Churn Risk Signals",
    prompt: "Identify customers showing signs of churn risk based on recent interactions. What are the common themes in their complaints or concerns?",
    category: "churn",
    icon: "AlertTriangle",
    priority: 9,
    user_id: null,
  },
  {
    label: "Integration Issues",
    prompt: "Summarize the most common integration and technical issues customers are facing. Which integrations are causing the most friction?",
    category: "integration",
    icon: "Puzzle",
    priority: 7,
    user_id: null,
  },
  {
    label: "Sales Call Insights",
    prompt: "What patterns are emerging from recent sales calls? What objections are prospects raising and how are they being addressed?",
    category: "sales",
    icon: "TrendingUp",
    priority: 6,
    user_id: null,
  },
];

// Global cache for suggestions
let globalSuggestionsCache: {
  suggestions: Suggestion[];
  userId: string | null;
  timestamp: number;
} | null = null;

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export const useSuggestionCache = (userId: string | null) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSuggestions = useCallback(async (isRefresh = false) => {
    // Check cache first (if not refreshing and same user)
    if (!isRefresh && globalSuggestionsCache && 
        globalSuggestionsCache.userId === userId &&
        (Date.now() - globalSuggestionsCache.timestamp) < CACHE_TTL) {
      setSuggestions(globalSuggestionsCache.suggestions);
      setLoading(false);
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      // Regenerate if refresh requested
      if (isRefresh && userId) {
        const currentLabels = suggestions.map(s => s.label);
        await supabase.functions.invoke('analyze-suggestions', {
          body: { userId, forceRegenerate: true, excludeLabels: currentLabels }
        });
      }

      let personalSuggestions: Suggestion[] = [];
      let globalSuggestions: Suggestion[] = [];

      // Fetch personal suggestions
      if (userId) {
        const { data: personal } = await supabase
          .from("dynamic_suggestions")
          .select("*")
          .eq("user_id", userId)
          .eq("is_active", true)
          .gt("expires_at", new Date().toISOString())
          .order("priority", { ascending: false })
          .limit(2);

        if (personal) {
          personalSuggestions = personal as Suggestion[];
        }
      }

      // Fetch global suggestions
      const globalLimit = 4 - personalSuggestions.length;
      const { data: global } = await supabase
        .from("dynamic_suggestions")
        .select("*")
        .is("user_id", null)
        .eq("is_active", true)
        .gt("expires_at", new Date().toISOString())
        .order("priority", { ascending: false })
        .limit(globalLimit);

      if (global) {
        globalSuggestions = global as Suggestion[];
      }

      // Combine and fill with defaults
      const combined = [...personalSuggestions, ...globalSuggestions];
      const defaultsWithIds = defaultSuggestions.map((s, i) => ({ ...s, id: `default-${i}` }));
      
      let finalSuggestions: Suggestion[];
      if (combined.length >= 4) {
        finalSuggestions = combined.slice(0, 4);
      } else if (combined.length > 0) {
        const remaining = 4 - combined.length;
        const fillers = defaultsWithIds
          .filter(d => !combined.some(c => c.label === d.label))
          .slice(0, remaining);
        finalSuggestions = [...combined, ...fillers];
      } else {
        finalSuggestions = defaultsWithIds.slice(0, 4);
      }

      // Update cache
      globalSuggestionsCache = {
        suggestions: finalSuggestions,
        userId,
        timestamp: Date.now()
      };

      setSuggestions(finalSuggestions);
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      const fallback = defaultSuggestions.map((s, i) => ({ ...s, id: `default-${i}` }));
      setSuggestions(fallback);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, suggestions]);

  useEffect(() => {
    fetchSuggestions();
  }, [userId]);

  return {
    suggestions,
    loading,
    refreshing,
    refresh: () => fetchSuggestions(true),
  };
};

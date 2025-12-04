import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Lightbulb, AlertTriangle, Puzzle, TrendingUp, Headset, Users, Sparkles, RefreshCw } from "lucide-react";

interface Suggestion {
  id: string;
  label: string;
  prompt: string;
  category: string;
  icon: string | null;
  priority: number;
  user_id: string | null;
}

interface DynamicSuggestionPillsProps {
  onSelect: (prompt: string) => void;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Lightbulb,
  AlertTriangle,
  Puzzle,
  TrendingUp,
  HeadsetIcon: Headset,
  Users,
};

const categoryColors: Record<string, string> = {
  churn: "bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20",
  feature: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20",
  integration: "bg-violet/10 text-violet border-violet/20 hover:bg-violet/20",
  trend: "bg-aqua/10 text-aqua border-aqua/20 hover:bg-aqua/20",
  support: "bg-muted text-muted-foreground border-border hover:bg-accent",
  sales: "bg-green-500/10 text-green-600 border-green-500/20 hover:bg-green-500/20",
  general: "bg-muted text-muted-foreground border-border hover:bg-accent",
};

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

export const DynamicSuggestionPills = ({ onSelect }: DynamicSuggestionPillsProps) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    fetchSuggestions();
  }, [user?.id]);

  const fetchSuggestions = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      let personalSuggestions: Suggestion[] = [];
      let globalSuggestions: Suggestion[] = [];

      // Fetch user's personalized suggestions (if logged in)
      if (user?.id) {
        const { data: personal } = await supabase
          .from("dynamic_suggestions")
          .select("*")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .gt("expires_at", new Date().toISOString())
          .order("priority", { ascending: false })
          .limit(2);

        if (personal) {
          personalSuggestions = personal as Suggestion[];
        }
      }

      // Fetch global suggestions - always fill up to 4 total
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

      // Combine: personal first, then global
      const combined = [...personalSuggestions, ...globalSuggestions];

      // Always ensure exactly 4 suggestions by filling from defaults if needed
      const defaultsWithIds = defaultSuggestions.map((s, i) => ({ ...s, id: `default-${i}` }));
      
      if (combined.length >= 4) {
        setSuggestions(combined.slice(0, 4));
      } else if (combined.length > 0) {
        // Fill remaining slots with defaults that aren't duplicates
        const remaining = 4 - combined.length;
        const fillers = defaultsWithIds
          .filter(d => !combined.some(c => c.label === d.label))
          .slice(0, remaining);
        setSuggestions([...combined, ...fillers]);
      } else {
        // Use all defaults if no suggestions found
        setSuggestions(defaultsWithIds.slice(0, 4));
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      setSuggestions(defaultSuggestions.map((s, i) => ({ ...s, id: `default-${i}` })));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 mt-6 animate-pulse">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 bg-muted/50 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-8">
      {/* Divider with label and refresh */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-border/60" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Try asking</span>
          <button
            onClick={() => fetchSuggestions(true)}
            disabled={refreshing}
            className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh suggestions"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex-1 h-px bg-border/60" />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        {suggestions.map((suggestion, index) => {
          const Icon = iconMap[suggestion.icon || "Lightbulb"] || Lightbulb;
          const colorClass = categoryColors[suggestion.category] || categoryColors.general;
          const isPersonal = suggestion.user_id !== null;

          return (
            <button
              key={suggestion.id}
              onClick={() => onSelect(suggestion.prompt)}
              className={`
                relative group flex items-center gap-2.5 px-4 py-3 rounded-xl border
                transition-all duration-200 text-left
                ${colorClass}
                animate-fade-in
              `}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-medium truncate">{suggestion.label}</span>
              {isPersonal && (
                <Sparkles className="w-3 h-3 absolute top-1.5 right-1.5 text-primary/60" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

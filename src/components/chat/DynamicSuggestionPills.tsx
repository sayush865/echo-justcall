import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Lightbulb, AlertTriangle, Puzzle, TrendingUp, Headset, Users, Sparkles } from "lucide-react";

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
  const { user } = useAuth();

  useEffect(() => {
    fetchSuggestions();
  }, [user?.id]);

  const fetchSuggestions = async () => {
    setLoading(true);
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

      // Fetch global suggestions
      const globalLimit = personalSuggestions.length > 0 ? 2 : 4;
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

      if (combined.length > 0) {
        setSuggestions(combined);
      } else {
        // Use defaults if no suggestions found
        setSuggestions(defaultSuggestions.map((s, i) => ({ ...s, id: `default-${i}` })));
      }
    } catch (error) {
      console.error("Error fetching suggestions:", error);
      setSuggestions(defaultSuggestions.map((s, i) => ({ ...s, id: `default-${i}` })));
    } finally {
      setLoading(false);
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
    <div className="grid grid-cols-2 gap-3 mt-6">
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
  );
};

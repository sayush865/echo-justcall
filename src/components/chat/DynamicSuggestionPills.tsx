import { Lightbulb, AlertTriangle, Puzzle, TrendingUp, Headset, Users, Sparkles, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSuggestionCache } from "@/hooks/useSuggestionCache";

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

export const DynamicSuggestionPills = ({ onSelect }: DynamicSuggestionPillsProps) => {
  const { user } = useAuth();
  const { suggestions, loading, refreshing, refresh } = useSuggestionCache(user?.id ?? null);

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
            onClick={refresh}
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

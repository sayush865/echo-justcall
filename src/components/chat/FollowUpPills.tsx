import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface FollowUpSuggestion {
  label: string;
  prompt: string;
}

interface FollowUpPillsProps {
  suggestions: FollowUpSuggestion[];
  onSelect: (prompt: string) => void;
  loading?: boolean;
}

export const FollowUpPills = ({ suggestions, onSelect, loading }: FollowUpPillsProps) => {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-2 mt-4">
        {[1, 2, 3].map((i) => (
          <Skeleton 
            key={i} 
            className="h-8 w-28 rounded-full"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mt-4">
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSelect(suggestion.prompt)}
          className="
            inline-flex items-center gap-1.5 px-3 py-1.5 text-sm
            rounded-full border border-border/60 bg-background/80
            text-muted-foreground hover:text-foreground hover:border-primary/40
            hover:bg-primary/5 transition-all duration-200
            animate-fade-in
          "
          style={{ animationDelay: `${index * 50}ms` }}
          title={suggestion.prompt}
        >
          <span className="truncate max-w-[180px]">{suggestion.label}</span>
          <ArrowRight className="w-3 h-3 flex-shrink-0 opacity-60" />
        </button>
      ))}
    </div>
  );
};

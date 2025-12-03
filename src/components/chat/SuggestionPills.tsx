interface SuggestionPillsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  loading?: boolean;
}

export const SuggestionPills = ({ suggestions, onSelect, loading }: SuggestionPillsProps) => {
  if (!suggestions.length || loading) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
      {suggestions.map((suggestion, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(suggestion)}
          className="flex-shrink-0 px-4 py-2 text-sm rounded-full 
                     bg-muted/50 border border-border/50 
                     hover:bg-primary/10 hover:border-primary/30 
                     transition-all text-foreground/80 hover:text-foreground
                     animate-fade-in"
          style={{ animationDelay: `${idx * 50}ms` }}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
};

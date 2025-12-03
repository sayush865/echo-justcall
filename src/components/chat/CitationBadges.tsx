import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronDown, ChevronUp, Phone, Copy, Check } from "lucide-react";
import { Citation, groupCitationsByType } from "@/lib/citationParser";
import { cn } from "@/lib/utils";

interface CitationBadgesProps {
  citations: Citation[];
}

const typeConfig: Record<Citation["type"], { label: string; className: string; icon: string }> = {
  sales: {
    label: "Sales",
    className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20",
    icon: "🟢",
  },
  support: {
    label: "Support",
    className: "bg-blue-500/10 text-blue-600 border-blue-500/20 hover:bg-blue-500/20",
    icon: "🔵",
  },
  success: {
    label: "Success",
    className: "bg-violet-500/10 text-violet-600 border-violet-500/20 hover:bg-violet-500/20",
    icon: "🟣",
  },
  unknown: {
    label: "Call",
    className: "bg-muted text-muted-foreground border-border hover:bg-muted/80",
    icon: "📞",
  },
};

function CitationChip({ citation }: { citation: Citation }) {
  const [copied, setCopied] = useState(false);
  const config = typeConfig[citation.type];
  const truncatedId = `${citation.id.slice(0, 8)}...`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(citation.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors cursor-pointer",
              config.className
            )}
          >
            <Phone className="w-3 h-3" />
            <span>{truncatedId}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2">
          <span className="font-mono text-xs">{citation.id}</span>
          {copied ? (
            <Check className="w-3 h-3 text-emerald-500" />
          ) : (
            <Copy className="w-3 h-3 text-muted-foreground" />
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function CitationBadges({ citations }: CitationBadgesProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (citations.length === 0) return null;

  const grouped = groupCitationsByType(citations);
  const types = (Object.keys(grouped) as Citation["type"][]).filter(
    (type) => grouped[type]?.length > 0
  );

  return (
    <div className="mt-4 pt-3 border-t border-border/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {isExpanded ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
        <span className="font-medium">Sources</span>
        <span className="text-muted-foreground/70">({citations.length} calls referenced)</span>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-3 animate-fade-in">
          {/* Summary badges by type */}
          <div className="flex flex-wrap gap-2">
            {types.map((type) => {
              const config = typeConfig[type];
              const count = grouped[type].length;
              return (
                <Badge
                  key={type}
                  variant="outline"
                  className={cn("gap-1.5 py-1", config.className)}
                >
                  <span>{config.icon}</span>
                  <span>{config.label}</span>
                  <span className="opacity-70">({count})</span>
                </Badge>
              );
            })}
          </div>

          {/* Individual citation chips */}
          <div className="flex flex-wrap gap-1.5">
            {citations.map((citation, idx) => (
              <CitationChip key={`${citation.id}-${idx}`} citation={citation} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

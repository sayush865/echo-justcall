import { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Citation } from "@/lib/citationParser";

interface InlineCitationPillProps {
  citation: Citation;
}

const typeConfig: Record<Citation["type"], { label: string; colorClass: string; dotClass: string }> = {
  sales: { 
    label: "Sales Call", 
    colorClass: "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30",
    dotClass: "bg-emerald-400"
  },
  support: { 
    label: "Support Call", 
    colorClass: "bg-sky-500/20 text-sky-400 hover:bg-sky-500/30",
    dotClass: "bg-sky-400"
  },
  success: { 
    label: "Success Call", 
    colorClass: "bg-violet-500/20 text-violet-400 hover:bg-violet-500/30",
    dotClass: "bg-violet-400"
  },
  unknown: { 
    label: "Call", 
    colorClass: "bg-muted text-muted-foreground hover:bg-muted/80",
    dotClass: "bg-muted-foreground"
  },
};

// Circled number characters
const circledNumbers = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];

export const InlineCitationPill = ({ citation }: InlineCitationPillProps) => {
  const [copied, setCopied] = useState(false);
  const config = typeConfig[citation.type];
  const displayNumber = citation.sourceNumber !== undefined && citation.sourceNumber <= 10 
    ? circledNumbers[citation.sourceNumber] 
    : `[${citation.sourceNumber}]`;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer align-baseline mx-0.5 ${config.colorClass}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
            <span>{displayNumber}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          className="bg-popover border border-border shadow-lg"
        >
          <div className="flex flex-col gap-1.5 p-1">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${config.dotClass}`} />
              <span className="font-medium text-foreground">{config.label}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                {citation.id.slice(0, 12)}...
              </code>
              <button
                onClick={handleCopy}
                className="p-1 hover:bg-muted rounded transition-colors"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

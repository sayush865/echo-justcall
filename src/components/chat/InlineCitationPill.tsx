import { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import type { Citation } from "@/lib/citationParser";

interface InlineCitationPillProps {
  citation: Citation;
}

const typeLabels: Record<Citation["type"], string> = {
  sales: "Sales Call",
  support: "Support Call",
  success: "Success Call",
  unknown: "Call",
};

// Circled number characters
const circledNumbers = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", 
  "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];

export const InlineCitationPill = ({ citation }: InlineCitationPillProps) => {
  const [copied, setCopied] = useState(false);
  const label = typeLabels[citation.type];
  
  const displayNumber = citation.sourceNumber !== undefined && citation.sourceNumber <= 20 
    ? circledNumbers[citation.sourceNumber] 
    : `[${citation.sourceNumber}]`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(citation.id);
      setCopied(true);
      toast.success("Call ID copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy");
    }
  };

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-medium transition-all duration-200 cursor-pointer align-baseline mx-0.5 bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/50"
          >
            <span>{displayNumber}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          align="center"
          className="max-w-xs p-3 bg-popover border border-border shadow-xl"
          sideOffset={6}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-sm text-foreground">{label}</span>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1.5 hover:bg-muted rounded-md transition-colors"
                title="Copy Call ID"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </div>
            <code className="block bg-muted px-2 py-1.5 rounded text-xs font-mono text-foreground break-all">
              {citation.id}
            </code>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

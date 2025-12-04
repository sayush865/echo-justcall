import { useState } from "react";
import { Check, Copy, Phone, Headphones, UserCheck, HelpCircle } from "lucide-react";
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

const typeConfig: Record<Citation["type"], { 
  label: string; 
  colorClass: string; 
  dotClass: string;
  bgClass: string;
  Icon: typeof Phone;
}> = {
  sales: { 
    label: "Sales Call", 
    colorClass: "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30",
    dotClass: "bg-emerald-400",
    bgClass: "bg-emerald-500/10",
    Icon: Phone,
  },
  support: { 
    label: "Support Call", 
    colorClass: "bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 border border-sky-500/30",
    dotClass: "bg-sky-400",
    bgClass: "bg-sky-500/10",
    Icon: Headphones,
  },
  success: { 
    label: "Success Call", 
    colorClass: "bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 border border-violet-500/30",
    dotClass: "bg-violet-400",
    bgClass: "bg-violet-500/10",
    Icon: UserCheck,
  },
  unknown: { 
    label: "Call", 
    colorClass: "bg-muted text-muted-foreground hover:bg-muted/80 border border-border",
    dotClass: "bg-muted-foreground",
    bgClass: "bg-muted/50",
    Icon: HelpCircle,
  },
};

// Circled number characters
const circledNumbers = ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", 
  "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];

export const InlineCitationPill = ({ citation }: InlineCitationPillProps) => {
  const [copied, setCopied] = useState(false);
  const config = typeConfig[citation.type];
  const Icon = config.Icon;
  
  const displayNumber = citation.sourceNumber !== undefined && citation.sourceNumber <= 20 
    ? circledNumbers[citation.sourceNumber] 
    : `[${citation.sourceNumber}]`;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(citation.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <TooltipProvider delayDuration={100}>
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
          align="center"
          className="max-w-xs p-0 bg-popover border border-border shadow-xl"
          sideOffset={8}
        >
          <div className="p-3 space-y-2">
            {/* Header with type */}
            <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${config.bgClass}`}>
              <Icon className="w-4 h-4" />
              <span className="font-semibold text-sm">{config.label}</span>
              <span className={`ml-auto w-2 h-2 rounded-full ${config.dotClass}`} />
            </div>
            
            {/* Call ID section */}
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Call ID</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-muted px-2 py-1.5 rounded text-xs font-mono text-foreground truncate max-w-[180px]">
                  {citation.id}
                </code>
                <span className="p-1 shrink-0">
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  )}
                </span>
              </div>
            </div>
            
            {/* Click hint */}
            <p className="text-[10px] text-muted-foreground text-center">
              Click to copy
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

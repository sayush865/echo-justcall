import { useState } from "react";
import { Check, Copy, Phone, Headphones, UserCheck, HelpCircle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  const [open, setOpen] = useState(false);
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer align-baseline mx-0.5 ${config.colorClass}`}
          onClick={() => setOpen(true)}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
          <span>{displayNumber}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        side="top" 
        align="center"
        className="w-auto max-w-xs p-0 bg-popover border border-border shadow-xl"
        sideOffset={8}
      >
        <div className="p-3 space-y-3">
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
              <code className="flex-1 bg-muted px-2 py-1.5 rounded text-xs font-mono text-foreground truncate">
                {citation.id}
              </code>
              <button
                onClick={handleCopy}
                className="p-1.5 hover:bg-muted rounded-md transition-colors shrink-0"
                title="Copy Call ID"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
          
          {/* Source number badge */}
          {citation.sourceNumber !== undefined && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Reference</span>
              <span className={`px-1.5 py-0.5 rounded ${config.bgClass} font-medium`}>
                Source {citation.sourceNumber}
              </span>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

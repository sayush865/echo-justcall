import { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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

export const InlineCitationPill = ({ citation }: InlineCitationPillProps) => {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const label = typeLabels[citation.type];
  const isStreaming = citation.isStreaming;
  
  const displayText = `Source ${citation.sourceNumber}`;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isStreaming) return;
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`
            inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium 
            transition-all duration-200 cursor-pointer align-baseline mx-0.5
            bg-muted/80 text-muted-foreground border border-border/50 
            hover:bg-muted hover:border-border
          `}
        >
          <span>{displayText}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        side="top" 
        align="center"
        className="w-auto max-w-xs p-3"
        sideOffset={6}
      >
        {isStreaming ? (
          <div className="text-sm text-muted-foreground">
            Loading source details...
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {displayText}
                </span>
                <span className="font-medium text-sm text-foreground">{label}</span>
              </div>
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
        )}
      </PopoverContent>
    </Popover>
  );
};
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Download, FileText, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import { format } from "date-fns";

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationTitle: string;
  messages: Message[];
}

export const ExportDialog = ({
  open,
  onOpenChange,
  conversationTitle,
  messages,
}: ExportDialogProps) => {
  const [includeTimestamps, setIncludeTimestamps] = useState(true);
  const [includeBranding, setIncludeBranding] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const stripMarkdown = (text: string): string => {
    // Remove code blocks
    let result = text.replace(/```[\s\S]*?```/g, (match) => {
      const code = match.replace(/```\w*\n?/g, "").replace(/```/g, "");
      return `[Code]\n${code}\n[/Code]`;
    });
    // Remove inline code
    result = result.replace(/`([^`]+)`/g, "$1");
    // Remove bold/italic
    result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
    result = result.replace(/\*([^*]+)\*/g, "$1");
    result = result.replace(/__([^_]+)__/g, "$1");
    result = result.replace(/_([^_]+)_/g, "$1");
    // Remove headers
    result = result.replace(/^#{1,6}\s+/gm, "");
    // Remove links but keep text
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    // Remove images
    result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");
    // Remove blockquotes
    result = result.replace(/^>\s+/gm, "");
    // Remove horizontal rules
    result = result.replace(/^[-*_]{3,}$/gm, "");
    // Remove list markers
    result = result.replace(/^[\s]*[-*+]\s+/gm, "• ");
    result = result.replace(/^[\s]*\d+\.\s+/gm, "");
    // Clean up citation markers like [[1]]
    result = result.replace(/\[\[\d+\]\]/g, "");
    
    return result.trim();
  };

  const handleExport = async () => {
    if (messages.length === 0) {
      toast.error("No messages to export");
      return;
    }

    setIsExporting(true);

    try {
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let yPos = margin;

      const addNewPage = () => {
        pdf.addPage();
        yPos = margin;
        if (includeBranding) {
          addPageFooter();
        }
      };

      const addPageFooter = () => {
        const pageCount = pdf.getNumberOfPages();
        pdf.setFontSize(9);
        pdf.setTextColor(150);
        pdf.text(
          `Page ${pageCount}`,
          pageWidth / 2,
          pageHeight - 10,
          { align: "center" }
        );
      };

      const checkPageBreak = (height: number) => {
        if (yPos + height > pageHeight - 25) {
          addNewPage();
          return true;
        }
        return false;
      };

      // Header with branding
      if (includeBranding) {
        // Echo branding header
        pdf.setFillColor(58, 96, 248); // Echo Blue
        pdf.rect(0, 0, pageWidth, 35, "F");
        
        pdf.setTextColor(255);
        pdf.setFontSize(20);
        pdf.setFont("helvetica", "bold");
        pdf.text("Echo", margin, 20);
        
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text("Conversation Export", margin, 28);
        
        yPos = 45;
      }

      // Title
      pdf.setTextColor(30);
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      const titleLines = pdf.splitTextToSize(conversationTitle, contentWidth);
      pdf.text(titleLines, margin, yPos);
      yPos += titleLines.length * 7 + 3;

      // Export date
      pdf.setFontSize(10);
      pdf.setTextColor(100);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Exported on ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")}`, margin, yPos);
      yPos += 5;
      
      // Message count
      pdf.text(`${messages.length} messages`, margin, yPos);
      yPos += 12;

      // Separator line
      pdf.setDrawColor(220);
      pdf.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 10;

      // Messages
      for (const msg of messages) {
        const isUser = msg.role === "user";
        const roleLabel = isUser ? "You" : "Echo";
        const cleanContent = stripMarkdown(msg.content);
        
        // Role label
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.setTextColor(isUser ? 58 : 100, isUser ? 96 : 100, isUser ? 248 : 100); // Echo Blue for user
        
        checkPageBreak(20);
        pdf.text(roleLabel, margin, yPos);
        
        // Timestamp
        if (includeTimestamps) {
          pdf.setFontSize(9);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(150);
          const timestamp = format(new Date(msg.created_at), "MMM d, h:mm a");
          pdf.text(timestamp, margin + 25, yPos);
        }
        yPos += 6;

        // Message content
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(50);
        
        const lines = pdf.splitTextToSize(cleanContent, contentWidth);
        
        for (let i = 0; i < lines.length; i++) {
          checkPageBreak(5);
          pdf.text(lines[i], margin, yPos);
          yPos += 5;
        }
        
        yPos += 8; // Space between messages
      }

      // Add footer to last page
      if (includeBranding) {
        addPageFooter();
        
        // Also add footer to all previous pages
        const totalPages = pdf.getNumberOfPages();
        for (let i = 1; i < totalPages; i++) {
          pdf.setPage(i);
          pdf.setFontSize(9);
          pdf.setTextColor(150);
          pdf.text(
            `Page ${i}`,
            pageWidth / 2,
            pageHeight - 10,
            { align: "center" }
          );
        }
      }

      // Generate filename
      const safeTitle = conversationTitle
        .replace(/[^a-z0-9]/gi, "_")
        .substring(0, 30);
      const filename = `Echo_${safeTitle}_${format(new Date(), "yyyy-MM-dd")}.pdf`;

      pdf.save(filename);
      toast.success("Conversation exported successfully");
      onOpenChange(false);
    } catch (error) {
      console.error("Export error:", error);
      toast.error("Failed to export conversation");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="w-5 h-5 text-primary" />
            Export Conversation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Preview */}
          <div className="bg-muted/50 rounded-lg p-4 border border-border">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <FileText className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{conversationTitle}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {messages.length} messages • PDF format
                </p>
              </div>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Options</p>
            
            <div className="flex items-center space-x-3">
              <Checkbox
                id="timestamps"
                checked={includeTimestamps}
                onCheckedChange={(checked) => setIncludeTimestamps(checked === true)}
              />
              <Label htmlFor="timestamps" className="text-sm cursor-pointer">
                Include timestamps
              </Label>
            </div>

            <div className="flex items-center space-x-3">
              <Checkbox
                id="branding"
                checked={includeBranding}
                onCheckedChange={(checked) => setIncludeBranding(checked === true)}
              />
              <Label htmlFor="branding" className="text-sm cursor-pointer">
                Include Echo branding
              </Label>
            </div>
          </div>

          {/* Export Button */}
          <Button
            onClick={handleExport}
            disabled={isExporting || messages.length === 0}
            className="w-full gap-2"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating PDF...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Download PDF
              </>
            )}
          </Button>

          {messages.length === 0 && (
            <p className="text-xs text-center text-muted-foreground">
              No messages to export yet
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

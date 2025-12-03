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
import { Download, FileText, Loader2 } from "lucide-react";
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
    let result = text;
    
    // Handle code blocks - preserve content with markers
    result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `\n━━━ Code${lang ? ` (${lang})` : ""} ━━━\n${code.trim()}\n━━━━━━━━━━━━\n`;
    });
    
    // Remove inline code backticks
    result = result.replace(/`([^`]+)`/g, "$1");
    
    // Convert headers to bold-like text
    result = result.replace(/^#{1,6}\s+(.+)$/gm, "\n$1\n");
    
    // Remove bold/italic markers
    result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
    result = result.replace(/\*([^*]+)\*/g, "$1");
    result = result.replace(/__([^_]+)__/g, "$1");
    result = result.replace(/_([^_]+)_/g, "$1");
    
    // Convert links to text with URL
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
    
    // Remove images
    result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "[Image: $1]");
    
    // Convert blockquotes
    result = result.replace(/^>\s+(.+)$/gm, "│ $1");
    
    // Remove horizontal rules
    result = result.replace(/^[-*_]{3,}$/gm, "────────────────");
    
    // Convert list markers
    result = result.replace(/^[\s]*[-*+]\s+/gm, "  • ");
    result = result.replace(/^[\s]*(\d+)\.\s+/gm, "  $1. ");
    
    // Clean up citation markers
    result = result.replace(/\[\[\d+\]\]/g, "");
    
    // Clean up excessive newlines
    result = result.replace(/\n{3,}/g, "\n\n");
    
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
      const marginLeft = 15;
      const marginRight = 15;
      const marginTop = 15;
      const marginBottom = 20;
      const contentWidth = pageWidth - marginLeft - marginRight;
      const lineHeight = 5;
      const paragraphSpacing = 3;
      
      let yPos = marginTop;
      let currentPage = 1;

      const addNewPage = () => {
        pdf.addPage();
        currentPage++;
        yPos = marginTop;
      };

      const checkPageBreak = (neededHeight: number): boolean => {
        if (yPos + neededHeight > pageHeight - marginBottom) {
          addNewPage();
          return true;
        }
        return false;
      };

      const addFooters = () => {
        const totalPages = pdf.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
          pdf.setPage(i);
          pdf.setFontSize(8);
          pdf.setTextColor(140, 140, 140);
          pdf.text(
            `Page ${i} of ${totalPages}`,
            pageWidth / 2,
            pageHeight - 8,
            { align: "center" }
          );
          if (includeBranding) {
            pdf.text("Echo — Customer Intelligence", marginLeft, pageHeight - 8);
          }
        }
      };

      // === HEADER ===
      if (includeBranding) {
        // Blue header bar
        pdf.setFillColor(58, 96, 248);
        pdf.rect(0, 0, pageWidth, 28, "F");
        
        // Logo text
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(18);
        pdf.setFont("helvetica", "bold");
        pdf.text("Echo", marginLeft, 14);
        
        // Subtitle
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text("Conversation Export", marginLeft, 21);
        
        // Date on right
        pdf.setFontSize(9);
        pdf.text(
          format(new Date(), "MMM d, yyyy"),
          pageWidth - marginRight,
          14,
          { align: "right" }
        );
        
        yPos = 38;
      }

      // === TITLE SECTION ===
      pdf.setTextColor(30, 30, 30);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      
      const titleLines = pdf.splitTextToSize(conversationTitle, contentWidth);
      for (const line of titleLines) {
        checkPageBreak(7);
        pdf.text(line, marginLeft, yPos);
        yPos += 6;
      }
      yPos += 2;

      // Message count subtitle
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${messages.length} messages`, marginLeft, yPos);
      yPos += 10;

      // Divider line
      pdf.setDrawColor(220, 220, 220);
      pdf.setLineWidth(0.3);
      pdf.line(marginLeft, yPos, pageWidth - marginRight, yPos);
      yPos += 8;

      // === MESSAGES ===
      for (let msgIndex = 0; msgIndex < messages.length; msgIndex++) {
        const msg = messages[msgIndex];
        const isUser = msg.role === "user";
        const roleLabel = isUser ? "You" : "Echo";
        const cleanContent = stripMarkdown(msg.content);
        
        // Estimate message height for page break check
        const contentLines = pdf.splitTextToSize(cleanContent, contentWidth - 10);
        const estimatedHeight = 12 + (contentLines.length * lineHeight);
        
        // Check if we need a new page before starting message
        if (yPos + Math.min(estimatedHeight, 40) > pageHeight - marginBottom) {
          addNewPage();
        }

        // Message container background
        const bgStartY = yPos - 3;
        
        // Role label with colored indicator
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "bold");
        
        if (isUser) {
          pdf.setTextColor(58, 96, 248); // Echo Blue
        } else {
          pdf.setTextColor(80, 80, 80);
        }
        
        // Draw role indicator dot
        pdf.setFillColor(isUser ? 58 : 120, isUser ? 96 : 120, isUser ? 248 : 120);
        pdf.circle(marginLeft + 2, yPos - 1.5, 1.2, "F");
        
        pdf.text(roleLabel, marginLeft + 6, yPos);
        
        // Timestamp
        if (includeTimestamps) {
          pdf.setFontSize(8);
          pdf.setFont("helvetica", "normal");
          pdf.setTextColor(140, 140, 140);
          try {
            const timestamp = format(new Date(msg.created_at), "MMM d, h:mm a");
            pdf.text(timestamp, marginLeft + 20, yPos);
          } catch {
            // Skip invalid timestamps
          }
        }
        
        yPos += 6;

        // Message content
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(40, 40, 40);
        
        // Process content line by line for proper wrapping
        const paragraphs = cleanContent.split("\n");
        
        for (const paragraph of paragraphs) {
          if (!paragraph.trim()) {
            yPos += paragraphSpacing;
            continue;
          }
          
          // Check for code block markers
          const isCodeMarker = paragraph.includes("━━━");
          if (isCodeMarker) {
            pdf.setFont("courier", "normal");
            pdf.setFontSize(8);
            pdf.setTextColor(100, 100, 100);
          }
          
          const lines = pdf.splitTextToSize(paragraph.trim(), contentWidth - 8);
          
          for (const line of lines) {
            checkPageBreak(lineHeight);
            pdf.text(line, marginLeft + 4, yPos);
            yPos += lineHeight;
          }
          
          // Reset font after code
          if (isCodeMarker) {
            pdf.setFont("helvetica", "normal");
            pdf.setFontSize(10);
            pdf.setTextColor(40, 40, 40);
          }
        }
        
        // Draw subtle background for message
        const bgEndY = yPos + 2;
        const bgHeight = bgEndY - bgStartY;
        
        pdf.setPage(pdf.getNumberOfPages()); // Ensure we're on current page
        pdf.setFillColor(isUser ? 245 : 250, isUser ? 247 : 250, isUser ? 255 : 250);
        pdf.roundedRect(marginLeft - 2, bgStartY, contentWidth + 4, bgHeight, 2, 2, "F");
        
        // Re-render text on top of background (jsPDF limitation)
        // Skip re-render for simplicity - background will be behind

        yPos += 10; // Space between messages
        
        // Add separator line between messages (except last)
        if (msgIndex < messages.length - 1) {
          pdf.setDrawColor(235, 235, 235);
          pdf.setLineWidth(0.2);
          checkPageBreak(5);
          pdf.line(marginLeft + 10, yPos - 5, pageWidth - marginRight - 10, yPos - 5);
        }
      }

      // Add footers to all pages
      addFooters();

      // Generate filename
      const safeTitle = conversationTitle
        .replace(/[^a-z0-9]/gi, "_")
        .replace(/_+/g, "_")
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

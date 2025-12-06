import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Check, Link, Loader2, Trash2, Clock } from "lucide-react";
import { format } from "date-fns";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationTitle: string;
}

export const ShareDialog = ({
  open,
  onOpenChange,
  conversationId,
  conversationTitle,
}: ShareDialogProps) => {
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-create share link when dialog opens
  useEffect(() => {
    if (open && conversationId) {
      checkOrCreateShareLink();
    }
  }, [open, conversationId]);

  const checkOrCreateShareLink = async () => {
    setLoading(true);
    try {
      // First check for existing share
      const { data: existingShare, error: checkError } = await supabase
        .from("conversation_shares")
        .select("share_token, is_active, expires_at")
        .eq("conversation_id", conversationId)
        .eq("is_active", true)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existingShare) {
        const link = `${window.location.origin}/shared/${existingShare.share_token}`;
        setShareLink(link);
        setShareToken(existingShare.share_token);
        setExpiresAt(existingShare.expires_at);
      } else {
        // Auto-create a new share link (never expires by default)
        const { data: { user } } = await supabase.auth.getUser();
        
        const { data: newShare, error: createError } = await supabase
          .from("conversation_shares")
          .insert({
            conversation_id: conversationId,
            created_by: user?.id,
            expires_at: null,
          })
          .select("share_token, expires_at")
          .single();

        if (createError) throw createError;

        const link = `${window.location.origin}/shared/${newShare.share_token}`;
        setShareLink(link);
        setShareToken(newShare.share_token);
        setExpiresAt(newShare.expires_at);
        
        // Auto-copy to clipboard
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          toast.success("Share link created and copied!");
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.success("Share link created!");
        }
      }
    } catch (error) {
      console.error("Error with share link:", error);
      toast.error("Failed to create share link");
    } finally {
      setLoading(false);
    }
  };

  const deleteShareLink = async () => {
    if (!shareToken) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from("conversation_shares")
        .update({ is_active: false })
        .eq("share_token", shareToken);

      if (error) throw error;

      setShareLink(null);
      setShareToken(null);
      setExpiresAt(null);
      toast.success("Share link removed");
    } catch (error) {
      console.error("Error deleting share:", error);
      toast.error("Failed to remove share link");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!shareLink) return;
    
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      toast.success("Link copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy link");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="w-5 h-5" />
            Share Conversation
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : shareLink ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Anyone with this link can view this conversation.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  value={shareLink}
                  readOnly
                  className="text-sm"
                />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={copyToClipboard}
                  className="flex-shrink-0"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {expiresAt ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Expires {format(new Date(expiresAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Never expires
                </p>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={deleteShareLink}
                className="w-full"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove Share Link
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
};

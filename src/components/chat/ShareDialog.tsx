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
import { Copy, Check, Link, Loader2, Trash2 } from "lucide-react";

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
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check for existing share link when dialog opens
  useEffect(() => {
    if (open && conversationId) {
      checkExistingShare();
    }
  }, [open, conversationId]);

  const checkExistingShare = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("conversation_shares")
        .select("share_token, is_active")
        .eq("conversation_id", conversationId)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const link = `${window.location.origin}/shared/${data.share_token}`;
        setShareLink(link);
        setShareToken(data.share_token);
      } else {
        setShareLink(null);
        setShareToken(null);
      }
    } catch (error) {
      console.error("Error checking share:", error);
    } finally {
      setLoading(false);
    }
  };

  const createShareLink = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from("conversation_shares")
        .insert({
          conversation_id: conversationId,
          created_by: user?.id,
        })
        .select("share_token")
        .single();

      if (error) throw error;

      const link = `${window.location.origin}/shared/${data.share_token}`;
      setShareLink(link);
      setShareToken(data.share_token);
      toast.success("Share link created!");
    } catch (error: any) {
      console.error("Error creating share:", error);
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
          <p className="text-sm text-muted-foreground">
            {shareLink 
              ? "Anyone with this link can view this conversation."
              : "Create a public link to share this conversation."}
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : shareLink ? (
            <div className="space-y-3">
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
          ) : (
            <Button
              onClick={createShareLink}
              className="w-full"
            >
              <Link className="w-4 h-4 mr-2" />
              Create Share Link
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Check, Link, Loader2, Trash2, Clock } from "lucide-react";
import { addHours, addDays, format } from "date-fns";

type ExpirationOption = "24h" | "7d" | "never";

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
  const [expiration, setExpiration] = useState<ExpirationOption>("never");

  const getExpirationDate = (option: ExpirationOption): Date | null => {
    switch (option) {
      case "24h":
        return addHours(new Date(), 24);
      case "7d":
        return addDays(new Date(), 7);
      case "never":
        return null;
    }
  };

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
        .select("share_token, is_active, expires_at")
        .eq("conversation_id", conversationId)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const link = `${window.location.origin}/shared/${data.share_token}`;
        setShareLink(link);
        setShareToken(data.share_token);
        setExpiresAt(data.expires_at);
      } else {
        setShareLink(null);
        setShareToken(null);
        setExpiresAt(null);
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
      const expirationDate = getExpirationDate(expiration);
      
      const { data, error } = await supabase
        .from("conversation_shares")
        .insert({
          conversation_id: conversationId,
          created_by: user?.id,
          expires_at: expirationDate?.toISOString() || null,
        })
        .select("share_token, expires_at")
        .single();

      if (error) throw error;

      const link = `${window.location.origin}/shared/${data.share_token}`;
      setShareLink(link);
      setShareToken(data.share_token);
      setExpiresAt(data.expires_at);
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
              {expiresAt && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Expires {format(new Date(expiresAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              )}
              {!expiresAt && (
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
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Link expires</label>
                <Select value={expiration} onValueChange={(v) => setExpiration(v as ExpirationOption)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24h">24 hours</SelectItem>
                    <SelectItem value="7d">7 days</SelectItem>
                    <SelectItem value="never">Never</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={createShareLink}
                className="w-full"
              >
                <Link className="w-4 h-4 mr-2" />
                Create Share Link
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

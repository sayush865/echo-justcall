import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Copy, Check, CalendarIcon, Link2, Loader2, Trash2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { cn } from "@/lib/utils";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationTitle: string;
}

type ExpiryOption = "never" | "1day" | "7days" | "30days" | "custom";

export const ShareDialog = ({
  open,
  onOpenChange,
  conversationId,
  conversationTitle,
}: ShareDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [existingShare, setExistingShare] = useState<{
    id: string;
    share_token: string;
    expires_at: string | null;
    is_active: boolean;
  } | null>(null);
  const [expiryOption, setExpiryOption] = useState<ExpiryOption>("never");
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  // Load existing share when dialog opens
  useEffect(() => {
    if (open && conversationId) {
      loadExistingShare();
    }
  }, [open, conversationId]);

  const loadExistingShare = async () => {
    const { data, error } = await supabase
      .from("conversation_shares")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("is_active", true)
      .maybeSingle();

    if (!error && data) {
      setExistingShare(data);
      // Set expiry option based on existing share
      if (!data.expires_at) {
        setExpiryOption("never");
      } else {
        setExpiryOption("custom");
        setCustomDate(new Date(data.expires_at));
      }
    } else {
      setExistingShare(null);
      setExpiryOption("never");
      setCustomDate(undefined);
    }
  };

  const getExpiryDate = (): Date | null => {
    const now = new Date();
    switch (expiryOption) {
      case "never":
        return null;
      case "1day":
        return addDays(now, 1);
      case "7days":
        return addDays(now, 7);
      case "30days":
        return addDays(now, 30);
      case "custom":
        return customDate || null;
      default:
        return null;
    }
  };

  const generateShareLink = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const expiryDate = getExpiryDate();

      const { data, error } = await supabase
        .from("conversation_shares")
        .insert({
          conversation_id: conversationId,
          created_by: user.id,
          expires_at: expiryDate?.toISOString() || null,
        })
        .select()
        .single();

      if (error) throw error;

      setExistingShare(data);
      toast.success("Share link created");
    } catch (error: any) {
      toast.error(error.message || "Failed to create share link");
    } finally {
      setLoading(false);
    }
  };

  const updateExpiry = async () => {
    if (!existingShare) return;
    setLoading(true);
    try {
      const expiryDate = getExpiryDate();

      const { error } = await supabase
        .from("conversation_shares")
        .update({ expires_at: expiryDate?.toISOString() || null })
        .eq("id", existingShare.id);

      if (error) throw error;

      setExistingShare(prev => prev ? { ...prev, expires_at: expiryDate?.toISOString() || null } : null);
      toast.success("Expiry updated");
    } catch (error: any) {
      toast.error(error.message || "Failed to update expiry");
    } finally {
      setLoading(false);
    }
  };

  const revokeAccess = async () => {
    if (!existingShare) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("conversation_shares")
        .update({ is_active: false })
        .eq("id", existingShare.id);

      if (error) throw error;

      setExistingShare(null);
      toast.success("Share link revoked");
    } catch (error: any) {
      toast.error(error.message || "Failed to revoke access");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async () => {
    if (!existingShare) return;
    const shareUrl = `${window.location.origin}/share/${existingShare.share_token}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Link copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const shareUrl = existingShare 
    ? `${window.location.origin}/share/${existingShare.share_token}`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Share Conversation
          </DialogTitle>
          <DialogDescription>
            Share "{conversationTitle}" with anyone. They'll see a read-only view.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Expiry Options */}
          <div className="space-y-3">
            <Label>Link expires</Label>
            <RadioGroup value={expiryOption} onValueChange={(v) => setExpiryOption(v as ExpiryOption)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="never" id="never" />
                <Label htmlFor="never" className="font-normal cursor-pointer">Never</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="1day" id="1day" />
                <Label htmlFor="1day" className="font-normal cursor-pointer">1 day</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="7days" id="7days" />
                <Label htmlFor="7days" className="font-normal cursor-pointer">7 days</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="30days" id="30days" />
                <Label htmlFor="30days" className="font-normal cursor-pointer">30 days</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="custom" id="custom" />
                <Label htmlFor="custom" className="font-normal cursor-pointer">Custom date</Label>
              </div>
            </RadioGroup>

            {expiryOption === "custom" && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !customDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customDate ? format(customDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={customDate}
                    onSelect={setCustomDate}
                    disabled={(date) => date < new Date()}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Share Link Display */}
          {existingShare && (
            <div className="space-y-2">
              <Label>Share link</Label>
              <div className="flex gap-2">
                <Input
                  value={shareUrl}
                  readOnly
                  className="text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyToClipboard}
                  className="shrink-0"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              {existingShare.expires_at && (
                <p className="text-xs text-muted-foreground">
                  Expires {format(new Date(existingShare.expires_at), "PPP 'at' p")}
                </p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2">
            {!existingShare ? (
              <Button onClick={generateShareLink} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate Link
              </Button>
            ) : (
              <>
                <Button onClick={updateExpiry} disabled={loading} variant="secondary">
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Update Expiry
                </Button>
                <Button onClick={revokeAccess} disabled={loading} variant="destructive" className="gap-2">
                  <Trash2 className="h-4 w-4" />
                  Revoke Access
                </Button>
              </>
            )}
          </div>

          {/* Warning */}
          <p className="text-xs text-muted-foreground border-t pt-3">
            Anyone with this link can view this conversation (read-only).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

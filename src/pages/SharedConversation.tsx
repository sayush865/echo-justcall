import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EchoLogo } from "@/components/chat/EchoLogo";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { Loader2, AlertCircle, Eye } from "lucide-react";
import { format } from "date-fns";

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface ShareData {
  conversation_id: string;
  expires_at: string | null;
  created_at: string;
}

interface ConversationData {
  id: string;
  title: string;
  created_at: string;
}

const SharedConversation = () => {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [shareInfo, setShareInfo] = useState<ShareData | null>(null);

  useEffect(() => {
    if (shareToken) {
      loadSharedConversation();
    }
  }, [shareToken]);

  const loadSharedConversation = async () => {
    setLoading(true);
    setError(null);

    try {
      // First, verify the share token
      const { data: shareData, error: shareError } = await supabase
        .from("conversation_shares")
        .select("conversation_id, expires_at, created_at")
        .eq("share_token", shareToken)
        .eq("is_active", true)
        .maybeSingle();

      if (shareError) throw shareError;

      if (!shareData) {
        setError("This share link is invalid or has been revoked.");
        setLoading(false);
        return;
      }

      // Check if expired
      if (shareData.expires_at && new Date(shareData.expires_at) < new Date()) {
        setError("This share link has expired.");
        setLoading(false);
        return;
      }

      setShareInfo(shareData);

      // Load the conversation
      const { data: convData, error: convError } = await supabase
        .from("conversations")
        .select("id, title, created_at")
        .eq("id", shareData.conversation_id)
        .single();

      if (convError) throw convError;
      setConversation(convData);

      // Load messages
      const { data: msgData, error: msgError } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", shareData.conversation_id)
        .order("created_at", { ascending: true });

      if (msgError) throw msgError;
      setMessages(msgData || []);
    } catch (err: any) {
      setError(err.message || "Failed to load conversation");
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground">Loading conversation...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-4">
          <AlertCircle className="w-12 h-12 mx-auto text-destructive" />
          <h1 className="text-xl font-semibold">Link Unavailable</h1>
          <p className="text-muted-foreground">{error}</p>
          <Link 
            to="/" 
            className="inline-block mt-4 text-primary hover:underline"
          >
            Go to Echo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <EchoLogo size="sm" />
            <span className="font-semibold bg-[linear-gradient(135deg,hsl(227_93%_60%)_0%,hsl(256_100%_68%)_50%,hsl(195_100%_65%)_100%)] bg-clip-text text-transparent">
              Echo
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
            <Eye className="w-3 h-3" />
            View Only
          </div>
        </div>
      </header>

      {/* Conversation Title */}
      <div className="border-b border-border bg-muted/30">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <h1 className="font-medium text-sm md:text-base truncate">
            {conversation?.title || "Conversation"}
          </h1>
          {shareInfo && (
            <p className="text-xs text-muted-foreground mt-1">
              Shared on {format(new Date(shareInfo.created_at), "MMM d, yyyy")}
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "assistant" && (
                <EchoLogo size="sm" className="shrink-0 mt-0.5" />
              )}
              
              <div
                className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-muted/50 border border-border rounded-bl-md"
                }`}
              >
                {message.role === "assistant" ? (
                  <MarkdownRenderer content={message.content} />
                ) : (
                  <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                )}
                <p className={`text-xs mt-2 ${
                  message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"
                }`}>
                  {format(new Date(message.created_at), "h:mm a")}
                </p>
              </div>

              {message.role === "user" && (
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                    U
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30 py-4">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <p className="text-xs text-muted-foreground">
            Shared via{" "}
            <Link to="/" className="text-primary hover:underline font-medium">
              Echo
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
};

export default SharedConversation;

import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EchoLogo } from "@/components/chat/EchoLogo";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { format } from "date-fns";
import { Loader2, MessageSquare } from "lucide-react";

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface ConversationData {
  title: string;
  created_at: string;
}

const formatMessageTime = (dateString: string): string => {
  const date = new Date(dateString);
  return format(date, "d MMM, h:mm a");
};

const SharedConversation = () => {
  const { token } = useParams<{ token: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<ConversationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      loadSharedConversation();
    }
  }, [token]);

  const loadSharedConversation = async () => {
    try {
      // First, verify the share token and get conversation ID
      const { data: shareData, error: shareError } = await supabase
        .from("conversation_shares")
        .select("conversation_id, is_active, expires_at")
        .eq("share_token", token)
        .single();

      if (shareError || !shareData) {
        setError("This shared conversation was not found.");
        setLoading(false);
        return;
      }

      if (!shareData.is_active) {
        setError("This share link is no longer active.");
        setLoading(false);
        return;
      }

      if (shareData.expires_at && new Date(shareData.expires_at) < new Date()) {
        setError("This share link has expired.");
        setLoading(false);
        return;
      }

      // Load conversation details
      const { data: convData, error: convError } = await supabase
        .from("conversations")
        .select("title, created_at")
        .eq("id", shareData.conversation_id)
        .single();

      if (convError || !convData) {
        setError("Could not load conversation details.");
        setLoading(false);
        return;
      }

      setConversation(convData);

      // Load messages
      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", shareData.conversation_id)
        .order("created_at", { ascending: true });

      if (messagesError) {
        setError("Could not load messages.");
        setLoading(false);
        return;
      }

      setMessages(messagesData || []);
    } catch (err) {
      console.error("Error loading shared conversation:", err);
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading conversation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        <div className="text-center max-w-md">
          <MessageSquare className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{error}</h1>
          <p className="text-muted-foreground mb-6">
            The conversation you're looking for may have been removed or the link is invalid.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-primary hover:underline"
          >
            <EchoLogo size="sm" />
            Go to Echo
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Subtle gradient background */}
      <div className="fixed inset-0 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.03)_0%,hsl(256_100%_68%/0.04)_50%,hsl(195_100%_65%/0.03)_100%)] pointer-events-none" />
      <div className="fixed top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/3 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-aqua/3 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="flex-shrink-0">
              <EchoLogo size="md" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-medium text-sm truncate">{conversation?.title || "Shared Conversation"}</h1>
              <p className="text-xs text-muted-foreground">
                {conversation?.created_at && format(new Date(conversation.created_at), "MMM d, yyyy")}
              </p>
            </div>
          </div>
          <Link
            to="/"
            className="text-sm text-primary hover:underline flex-shrink-0"
          >
            Start your own chat
          </Link>
        </div>
      </header>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 md:px-6 py-6 relative z-10">
        <div className="space-y-6 max-w-3xl mx-auto pb-8">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role === "user" ? (
                <>
                  <div className="group max-w-[85%] md:max-w-[75%]">
                    <div className="rounded-2xl px-4 py-3 bg-muted text-foreground shadow-sm">
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                    <div className="flex justify-end items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {formatMessageTime(msg.created_at)}
                      </span>
                    </div>
                  </div>
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarFallback className="bg-muted text-xs font-medium">U</AvatarFallback>
                  </Avatar>
                </>
              ) : (
                <>
                  <EchoLogo size="md" className="mt-0.5" />
                  <div className="flex-1 group min-w-0">
                    <MarkdownRenderer content={msg.content} />
                    <div className="flex justify-start items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {formatMessageTime(msg.created_at)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <footer className="sticky bottom-0 z-20 bg-background/80 backdrop-blur-sm border-t border-border py-4">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground">
            Powered by{" "}
            <Link to="/" className="text-primary hover:underline font-medium">
              Echo
            </Link>
            {" "}— Bringing the Voice of Customers Back to You
          </p>
        </div>
      </footer>
    </div>
  );
};

export default SharedConversation;

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

const Chat = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [conversationTitle, setConversationTitle] = useState<string>("");
  const [isValidating, setIsValidating] = useState(false);
  // Start with sidebar closed on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  // Fetch conversation title and validate conversation exists
  useEffect(() => {
    if (conversationId) {
      setIsValidating(true);
      supabase
        .from("conversations")
        .select("title")
        .eq("id", conversationId)
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            toast({
              title: "Conversation not found",
              description: "This conversation doesn't exist or was deleted.",
              variant: "destructive",
            });
            navigate("/", { replace: true });
          } else {
            setConversationTitle(data.title);
          }
          setIsValidating(false);
        });
    } else {
      setConversationTitle("");
      setIsValidating(false);
    }
  }, [conversationId, navigate]);

  // Show loading skeleton while validating conversation
  if (conversationId && isValidating) {
    return (
      <div className="flex h-screen bg-background w-full">
        <div className="hidden md:flex w-72 flex-col border-r border-border bg-card p-4 gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-8 w-full" />
          <div className="space-y-2 mt-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
        <div className="flex-1 flex flex-col">
          <div className="h-16 border-b border-border flex items-center px-4">
            <Skeleton className="h-6 w-48" />
          </div>
          <div className="flex-1 p-4 space-y-4">
            <Skeleton className="h-20 w-3/4" />
            <Skeleton className="h-16 w-2/3 ml-auto" />
            <Skeleton className="h-24 w-3/4" />
          </div>
          <div className="p-4 border-t border-border">
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background w-full">
      <ConversationList
        selectedConversation={conversationId || null}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <ChatInterface
        conversationId={conversationId || null}
        conversationTitle={conversationTitle}
      />
    </div>
  );
};

export default Chat;

import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const Chat = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [conversationTitle, setConversationTitle] = useState<string>("");
  // Start with sidebar closed on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  // Fetch conversation title and validate conversation exists
  useEffect(() => {
    if (conversationId) {
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
        });
    } else {
      setConversationTitle("");
    }
  }, [conversationId, navigate]);

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

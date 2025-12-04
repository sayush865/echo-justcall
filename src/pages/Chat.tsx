import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { supabase } from "@/integrations/supabase/client";

const Chat = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [conversationTitle, setConversationTitle] = useState<string>("");
  // Start with sidebar closed on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  // Fetch conversation title when selected conversation changes
  useEffect(() => {
    if (conversationId) {
      supabase
        .from("conversations")
        .select("title")
        .eq("id", conversationId)
        .single()
        .then(({ data }) => {
          if (data) setConversationTitle(data.title);
        });
    } else {
      setConversationTitle("");
    }
  }, [conversationId]);

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

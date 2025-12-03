import { useState, useEffect } from "react";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { supabase } from "@/integrations/supabase/client";

const Chat = () => {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string>("");
  // Start with sidebar closed on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

  // Fetch conversation title when selected conversation changes
  useEffect(() => {
    if (selectedConversation) {
      supabase
        .from("conversations")
        .select("title")
        .eq("id", selectedConversation)
        .single()
        .then(({ data }) => {
          if (data) setConversationTitle(data.title);
        });
    } else {
      setConversationTitle("");
    }
  }, [selectedConversation]);

  return (
    <div className="flex h-screen bg-background w-full">
      <ConversationList
        selectedConversation={selectedConversation}
        onSelectConversation={setSelectedConversation}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <ChatInterface
        conversationId={selectedConversation}
        conversationTitle={conversationTitle}
        onConversationCreated={setSelectedConversation}
      />
    </div>
  );
};

export default Chat;

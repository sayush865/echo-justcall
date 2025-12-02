import { useState, useEffect } from "react";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatInterface } from "@/components/chat/ChatInterface";

const Chat = () => {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  // Start with sidebar closed on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);

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
        onConversationCreated={setSelectedConversation}
      />
    </div>
  );
};

export default Chat;

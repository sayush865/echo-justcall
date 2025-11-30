import { useState } from "react";
import { ConversationList } from "@/components/chat/ConversationList";
import { ChatInterface } from "@/components/chat/ChatInterface";

const Chat = () => {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);

  return (
    <div className="flex h-screen bg-background">
      <ConversationList
        selectedConversation={selectedConversation}
        onSelectConversation={setSelectedConversation}
      />
      <ChatInterface
        conversationId={selectedConversation}
        onConversationCreated={setSelectedConversation}
      />
    </div>
  );
};

export default Chat;

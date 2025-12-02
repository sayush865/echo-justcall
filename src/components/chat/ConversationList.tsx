import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, PanelLeftClose, PanelLeft } from "lucide-react";
import { toast } from "sonner";

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

interface ConversationListProps {
  selectedConversation: string | null;
  onSelectConversation: (id: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const ConversationList = ({
  selectedConversation,
  onSelectConversation,
  isOpen,
  onToggle,
}: ConversationListProps) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    loadConversations();

    const channel = supabase
      .channel("conversations")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
        },
        () => {
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadConversations = async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      toast.error("Failed to load conversations");
      return;
    }

    setConversations(data || []);
    
    // Auto-select the most recent conversation on first load only
    if (data && data.length > 0 && !selectedConversation && !hasLoadedOnce) {
      onSelectConversation(data[0].id);
      setHasLoadedOnce(true);
    }
  };

  const handleNewChat = () => {
    onSelectConversation(null);
    // Close sidebar on mobile after selecting
    if (window.innerWidth < 768) {
      onToggle();
    }
  };

  const handleSelectConversation = (id: string) => {
    onSelectConversation(id);
    // Close sidebar on mobile after selecting
    if (window.innerWidth < 768) {
      onToggle();
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={onToggle}
        />
      )}
      
      {/* Sidebar */}
      <div 
        className={`
          fixed md:relative z-50 md:z-auto
          h-full border-r border-border flex flex-col bg-card
          transition-all duration-300 ease-in-out
          ${isOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full md:w-0 md:translate-x-0'}
        `}
      >
        <div className={`${isOpen ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200 flex flex-col h-full min-w-64`}>
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
                Echo
              </h2>
              <Button variant="ghost" size="icon" onClick={onToggle} className="h-8 w-8">
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={handleNewChat} className="w-full" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              New Chat
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors flex items-center gap-2 ${
                    selectedConversation === conv.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-accent text-foreground"
                  }`}
                >
                  <MessageSquare className="w-4 h-4 shrink-0" />
                  <span className="truncate text-sm">{conv.title}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Toggle button when sidebar is closed */}
      {!isOpen && (
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onToggle}
          className="fixed md:absolute top-4 left-4 z-30 h-8 w-8 bg-card border border-border shadow-sm"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}
    </>
  );
};

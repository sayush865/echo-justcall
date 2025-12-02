import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, PanelLeftClose, PanelLeft } from "lucide-react";
import { toast } from "sonner";
import { triggerHaptic } from "@/hooks/useHapticFeedback";

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
    
    // Auto-select the most recent conversation on first load only (desktop only)
    if (data && data.length > 0 && !selectedConversation && !hasLoadedOnce && window.innerWidth >= 768) {
      onSelectConversation(data[0].id);
      setHasLoadedOnce(true);
    } else {
      setHasLoadedOnce(true);
    }
  };

  const handleNewChat = () => {
    triggerHaptic("medium");
    onSelectConversation(null);
    // Close sidebar on mobile after selecting
    if (window.innerWidth < 768) {
      onToggle();
    }
  };

  const handleSelectConversation = (id: string) => {
    triggerHaptic("light");
    onSelectConversation(id);
    // Close sidebar on mobile after selecting
    if (window.innerWidth < 768) {
      onToggle();
    }
  };

  const handleToggle = () => {
    triggerHaptic("light");
    onToggle();
  };

  return (
    <>
      {/* Mobile overlay */}
      <div 
        className={`
          fixed inset-0 z-40 md:hidden transition-all duration-300 ease-out
          ${isOpen ? 'bg-background/80 backdrop-blur-sm opacity-100' : 'bg-transparent backdrop-blur-0 opacity-0 pointer-events-none'}
        `}
        onClick={onToggle}
      />
      
      {/* Sidebar */}
      <div 
        className={`
          fixed md:relative z-50 md:z-auto
          h-full border-r border-border flex flex-col bg-card overflow-hidden
          transition-[width,transform] duration-300
          ${isOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full md:w-0 md:translate-x-0'}
        `}
        style={{ transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)' }}
      >
        <div className={`${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-200 ease-out flex flex-col h-full w-64`}>
          <div className="p-4 border-b border-border space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold bg-[linear-gradient(135deg,hsl(227_93%_60%)_0%,hsl(256_100%_68%)_50%,hsl(195_100%_65%)_100%)] bg-clip-text text-transparent">
                Echo
              </h2>
              <Button variant="ghost" size="icon" onClick={handleToggle} className="h-8 w-8">
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
          onClick={handleToggle}
          className="fixed md:absolute top-4 left-4 z-30 h-8 w-8 bg-card border border-border shadow-sm"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}
    </>
  );
};

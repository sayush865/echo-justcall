import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Plus, MessageSquare, PanelLeftClose, PanelLeft, MoreVertical, Trash2, Pencil, Pin, PinOff, Search, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { triggerHaptic } from "@/hooks/useHapticFeedback";
import { useAuth } from "@/hooks/useAuth";
import { EchoLogo } from "./EchoLogo";

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
  status: string;
  pinned: boolean;
  pending_response?: boolean;
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
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameConversationId, setRenameConversationId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteConversationId, setDeleteConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { user } = useAuth();

  const filteredConversations = conversations.filter((conv) =>
    conv.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    // Only load conversations when user is authenticated
    if (!user) {
      setConversations([]);
      return;
    }
    
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
  }, [user]);

  const loadConversations = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("status", "active")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Failed to load conversations:", error);
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

  const handleDeleteConversation = (e: React.MouseEvent | Event, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    triggerHaptic("medium");
    setDeleteConversationId(id);
  };

  const confirmDeleteConversation = async () => {
    if (!deleteConversationId) return;
    
    const { error } = await supabase
      .from("conversations")
      .update({ status: "deleted" })
      .eq("id", deleteConversationId);

    if (error) {
      toast.error("Failed to delete conversation");
      return;
    }

    if (selectedConversation === deleteConversationId) {
      onSelectConversation(null);
    }
    
    setDeleteConversationId(null);
    await loadConversations();
    toast.success("Conversation deleted");
  };

  const handleRenameConversation = async () => {
    if (!renameConversationId || !renameTitle.trim()) return;
    
    const { error } = await supabase
      .from("conversations")
      .update({ title: renameTitle.trim() })
      .eq("id", renameConversationId);

    if (error) {
      toast.error("Failed to rename conversation");
      return;
    }

    setRenameDialogOpen(false);
    setRenameConversationId(null);
    setRenameTitle("");
    await loadConversations();
    toast.success("Conversation renamed");
  };

  const openRenameDialog = (e: React.MouseEvent | Event, conv: Conversation) => {
    e.stopPropagation();
    e.preventDefault();
    setRenameConversationId(conv.id);
    setRenameTitle(conv.title);
    setRenameDialogOpen(true);
  };

  const handleTogglePin = async (e: React.MouseEvent | Event, conv: Conversation) => {
    e.stopPropagation();
    e.preventDefault();
    triggerHaptic("light");
    
    const { error } = await supabase
      .from("conversations")
      .update({ pinned: !conv.pinned })
      .eq("id", conv.id);

    if (error) {
      toast.error("Failed to update pin status");
      return;
    }

    await loadConversations();
    toast.success(conv.pinned ? "Unpinned" : "Pinned");
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
          <div className="p-4 border-b border-border space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <EchoLogo size="sm" />
                <h2 className="text-xl font-bold bg-[linear-gradient(135deg,hsl(227_93%_60%)_0%,hsl(256_100%_68%)_50%,hsl(195_100%_65%)_100%)] bg-clip-text text-transparent">
                  Echo
                </h2>
              </div>
              <Button variant="ghost" size="icon" onClick={handleToggle} className="h-8 w-8">
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={handleNewChat} className="w-full" size="sm">
              <Plus className="w-4 h-4 mr-2" />
              New Chat
            </Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="pl-8 pr-8 h-8 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1">
            <TooltipProvider>
            <div className="p-2 space-y-1">
                {filteredConversations.length === 0 && searchQuery ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No conversations found</p>
                ) : (
                  filteredConversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => handleSelectConversation(conv.id)}
                      className={`group w-full text-left p-2 rounded-lg transition-colors flex items-center cursor-pointer ${
                        selectedConversation === conv.id
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent text-foreground"
                      }`}
                    >
                      {conv.pending_response ? (
                        <Loader2 className="w-4 h-4 mr-2 flex-shrink-0 text-primary animate-spin" />
                      ) : conv.pinned ? (
                        <Pin className="w-4 h-4 mr-2 flex-shrink-0 text-primary" />
                      ) : (
                        <MessageSquare className="w-4 h-4 mr-2 flex-shrink-0" />
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm truncate flex-1 max-w-[140px]">{conv.title}</span>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[250px]">
                          {conv.title}
                        </TooltipContent>
                      </Tooltip>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 ml-auto flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem onSelect={(e) => openRenameDialog(e, conv)}>
                            <Pencil className="w-4 h-4 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={(e) => handleTogglePin(e, conv)}>
                            {conv.pinned ? (
                              <>
                                <PinOff className="w-4 h-4 mr-2" />
                                Unpin
                              </>
                            ) : (
                              <>
                                <Pin className="w-4 h-4 mr-2" />
                                Pin
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={(e) => handleDeleteConversation(e, conv.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))
                )}
              </div>
            </TooltipProvider>
          </ScrollArea>
        </div>
      </div>

      {/* Toggle button when sidebar is closed */}
      {!isOpen && (
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={handleToggle}
          className="fixed md:absolute top-8 left-4 z-30 h-9 w-9 bg-card border border-border shadow-sm"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
      )}

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            placeholder="Enter new title"
            onKeyDown={(e) => e.key === "Enter" && handleRenameConversation()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenameConversation}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConversationId} onOpenChange={(open) => !open && setDeleteConversationId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation and all its messages. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteConversation} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

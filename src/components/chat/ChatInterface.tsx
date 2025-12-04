import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Mic, MicOff, Send, Loader2, Copy, Check, ArrowDown, Share2, LogOut, Square } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { triggerHaptic } from "@/hooks/useHapticFeedback";
import { AnimatedPlaceholder } from "./AnimatedPlaceholder";
import { useAuth } from "@/hooks/useAuth";
import { AuthModal } from "@/components/auth/AuthModal";
import { EchoLogo } from "./EchoLogo";
import { ShareDialog } from "./ShareDialog";
import { DynamicSuggestionPills } from "./DynamicSuggestionPills";
import { FollowUpPills } from "./FollowUpPills";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Helper to get user initials
const getUserInitials = (displayName?: string | null): string => {
  if (!displayName) return "U";
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
};

// Helper to format message timestamp
const formatMessageTime = (dateString: string): string => {
  const date = new Date(dateString);
  return format(date, "d MMM, h:mm a"); // e.g., "21 Oct, 10:34 AM"
};

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface StreamingMessage {
  role: "assistant";
  content: string;
  isStreaming: boolean;
  steps?: string[];
}

interface ChatInterfaceProps {
  conversationId: string | null;
  conversationTitle?: string;
  onConversationCreated: (id: string) => void;
}

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000; // 1 second

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getErrorMessage = (error: any, status?: number): string => {
  if (status === 401) return "Authentication required. Please sign in again.";
  if (status === 403) return "You don't have permission to perform this action.";
  if (status === 429) return "Too many requests. Please wait a moment.";
  if (status === 500) return "Server error. Our team has been notified.";
  if (status === 503) return "Service temporarily unavailable. Please try again.";
  if (error?.message?.includes("RLS")) return "Permission denied. Please sign in again.";
  if (error?.message?.includes("network")) return "Network error. Check your connection.";
  return error?.message || "Something went wrong. Please try again.";
};

export const ChatInterface = ({
  conversationId,
  conversationTitle = "",
  onConversationCreated,
}: ChatInterfaceProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isUserNearBottom, setIsUserNearBottom] = useState(true);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<{label: string; prompt: string}[]>([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesCacheRef = useRef<Map<string, { messages: Message[]; followUps: {label: string; prompt: string}[] }>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef2 = useRef<HTMLTextAreaElement>(null);
  const activeConversationRef = useRef<string | null>(null);
  const { user, signOut } = useAuth();

  // Scroll handler to detect if user has scrolled up
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setIsUserNearBottom(distanceFromBottom < 100);
  };

  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>, ref: React.RefObject<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 200)}px`;
    }
  };

  // Auto-resize textarea when input changes (including from suggestions)
  useEffect(() => {
    [textareaRef, textareaRef2].forEach(ref => {
      if (ref.current) {
        ref.current.style.height = 'auto';
        if (input) {
          ref.current.style.height = `${Math.min(ref.current.scrollHeight, 200)}px`;
        }
      }
    });
  }, [input]);
  
  const { isListening, transcript, startListening, stopListening, resetTranscript, isSupported } = useVoiceInput();

  // Update input with transcript when voice input is active and auto-resize textarea
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
      // Auto-resize textareas for voice input
      [textareaRef, textareaRef2].forEach(ref => {
        if (ref.current) {
          ref.current.style.height = 'auto';
          ref.current.style.height = `${Math.min(ref.current.scrollHeight, 200)}px`;
        }
      });
    }
  }, [transcript]);

  useEffect(() => {
    // Track active conversation for preventing stale UI updates
    activeConversationRef.current = conversationId;
    
    // Reset local UI state when switching conversations (but don't abort - let backend continue)
    setLoading(false);
    setStreamingMessage(null);
    setFollowUpLoading(false);
    setRetryCount(0);
    setLastFailedMessage(null);
    
    if (conversationId) {
      // Check cache first for instant display
      const cached = messagesCacheRef.current.get(conversationId);
      if (cached) {
        setMessages(cached.messages);
        setFollowUpSuggestions(cached.followUps);
        // Still refresh in background for any new messages
        loadMessages(true);
      } else {
        setMessages([]);
        setFollowUpSuggestions([]);
        loadMessages(false);
      }

      const channel = supabase
        .channel(`messages:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            // Only update if still viewing this conversation
            if (activeConversationRef.current === conversationId) {
              loadMessages(true);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setMessages([]);
      setFollowUpSuggestions([]);
    }
  }, [conversationId]);

  // Only auto-scroll if user is near the bottom
  useEffect(() => {
    if (isUserNearBottom) {
      scrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingMessage, isUserNearBottom]);

  const loadMessages = async (isBackgroundRefresh = false) => {
    if (!conversationId) return;

    if (!isBackgroundRefresh) {
      setMessagesLoading(true);
    }

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    // Only update if still on same conversation
    if (activeConversationRef.current !== conversationId) return;

    setMessagesLoading(false);

    if (error) {
      toast.error("Failed to load messages");
      return;
    }

    const messages = data || [];
    let followUps: {label: string; prompt: string}[] = [];
    
    // Load follow-up suggestions from the last assistant message
    const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant");
    if (lastAssistantMsg?.follow_up_suggestions && Array.isArray(lastAssistantMsg.follow_up_suggestions)) {
      followUps = lastAssistantMsg.follow_up_suggestions as {label: string; prompt: string}[];
    }

    // Update cache
    messagesCacheRef.current.set(conversationId, { messages, followUps });
    
    setMessages(messages);
    setFollowUpSuggestions(followUps);
  };

  const handleSend = async (messageOverride?: string, skipAuthCheck?: boolean) => {
    const messageToSend = messageOverride || input.trim();
    if (!messageToSend || loading) return;
    
    // Check auth - if not logged in, show modal and save message
    if (!user && !skipAuthCheck) {
      setPendingMessage(messageToSend);
      setShowAuthModal(true);
      toast.info("Sign in to send your message", { description: "Your message is queued and will be sent after you sign in." });
      return;
    }
    
    triggerHaptic("medium");
    setInput("");
    resetTranscript();
    setLoading(true);
    setIsUserNearBottom(true); // Resume auto-scroll when user sends message
    setFollowUpSuggestions([]); // Clear follow-up suggestions when sending new message

    // Optimistically add user message to UI immediately
    const tempUserMsgId = `temp-user-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempUserMsgId,
      role: "user",
      content: messageToSend,
      created_at: new Date().toISOString()
    }]);

    try {
      let currentConversationId = conversationId;

      if (!currentConversationId) {
        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({ title: messageToSend.slice(0, 50), user_id: user?.id })
          .select()
          .single();

        if (convError) throw convError;
        currentConversationId = newConv.id;
        onConversationCreated(currentConversationId);
        
        // Log conversation creation
        await supabase.from("audit_logs").insert({
          user_id: user?.id,
          conversation_id: currentConversationId,
          event_type: "conversation_created",
          metadata: { title: messageToSend.slice(0, 50) },
        });
      }

      const { error: msgError } = await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "user",
        content: messageToSend,
        user_id: user?.id,
        user_email: user?.email,
      });

      if (msgError) throw msgError;

      // Use fetch for true streaming instead of supabase.functions.invoke
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      // Create AbortController for this request
      abortControllerRef.current = new AbortController();
      
      const response = await fetch(`${supabaseUrl}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ message: messageToSend, conversationId: currentConversationId }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";
      const steps: string[] = [];
      let buffer = ""; // Buffer for incomplete JSON lines
      
      // Only show streaming UI if this is the active conversation
      const isActiveConversation = () => activeConversationRef.current === currentConversationId;
      
      if (isActiveConversation()) {
        setStreamingMessage({ role: "assistant", content: "", isStreaming: true, steps: [] });
      }

      // Read the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Prepend any buffered content from previous chunk
        const text = buffer + chunk;
        buffer = "";
        
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          // If this is the last line and chunk doesn't end with newline, buffer it
          if (i === lines.length - 1 && !text.endsWith('\n')) {
            buffer = line;
            continue;
          }

          try {
            const parsed = JSON.parse(line);
            
            // Handle different event types from n8n - accumulate content regardless, but only update UI if active
            if (parsed.type === "item" && parsed.content) {
              fullContent += parsed.content;
              if (isActiveConversation()) {
                setStreamingMessage({ 
                  role: "assistant", 
                  content: fullContent, 
                  isStreaming: true,
                  steps 
                });
              }
            } else if (parsed.type === "step" || parsed.type === "tool" || parsed.type === "thinking") {
              // Handle intermediate steps (tool calls, thinking, etc.)
              const stepText = parsed.text || parsed.name || parsed.content || JSON.stringify(parsed);
              steps.push(stepText);
              if (isActiveConversation()) {
                setStreamingMessage(prev => prev ? { 
                  ...prev, 
                  steps: [...(prev.steps || []), stepText] 
                } : null);
              }
            } else if (parsed.type === "agent" && parsed.text) {
              // Agent status updates
              steps.push(parsed.text);
              if (isActiveConversation()) {
                setStreamingMessage(prev => prev ? { 
                  ...prev, 
                  steps: [...(prev.steps || []), parsed.text] 
                } : null);
              }
            }
          } catch {
            // JSON parse failed - don't add raw content, just log for debugging
            console.warn("Failed to parse NDJSON line:", line.substring(0, 50));
          }
        }
      }

      console.log("Streaming complete, fullContent length:", fullContent.length);
      
      // Only update UI if still on the same conversation
      if (isActiveConversation()) {
        // Finalize streaming
        setStreamingMessage({ role: "assistant", content: fullContent, isStreaming: false, steps });
        
        // Add to messages
        const tempId = `temp-${Date.now()}`;
        setMessages(prev => [...prev, {
          id: tempId,
          role: "assistant",
          content: fullContent,
          created_at: new Date().toISOString()
        }]);
        
        setStreamingMessage(null);
      } else {
        // User switched away - clear streaming state (response is saved to DB by edge function)
        setStreamingMessage(null);
      }

      console.log("Inserting message to DB for conversation:", currentConversationId);
      const { data: insertedMsg } = await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: fullContent,
        user_id: user?.id,
        user_email: user?.email,
      }).select('id').single();

      const assistantMessageId = insertedMsg?.id;

      // Generate follow-up suggestions and persist them
      console.log("Generating follow-ups for:", { messageToSend: messageToSend.substring(0, 50), responseLength: fullContent.length });
      setFollowUpLoading(true);
      supabase.functions.invoke('generate-followups', {
        body: { 
          lastUserMessage: messageToSend, 
          lastAIResponse: fullContent.substring(0, 1500),
        }
      }).then(async ({ data, error }) => {
        console.log("Follow-ups response:", { data, error });
        const suggestions = data?.suggestions || [];
        setFollowUpSuggestions(suggestions);
        
        // Persist follow-ups to the assistant message
        if (assistantMessageId && suggestions.length > 0) {
          await supabase.from("messages")
            .update({ follow_up_suggestions: suggestions })
            .eq("id", assistantMessageId);
          console.log("Follow-ups persisted to message:", assistantMessageId);
        }
      }).catch((err) => {
        console.error("Failed to generate follow-ups:", err);
        setFollowUpSuggestions([]);
      }).finally(() => {
        setFollowUpLoading(false);
      });
    } catch (error: any) {
      // Handle abort gracefully
      if (error?.name === 'AbortError') {
        console.log("Request was aborted by user");
        setStreamingMessage(null);
        setLoading(false);
        return;
      }
      
      setStreamingMessage(null);
      const errorMsg = getErrorMessage(error, error?.status);
      
      // Handle retry logic
      if (retryCount < MAX_RETRIES && !error?.message?.includes("RLS") && !error?.message?.includes("401")) {
        const delay = INITIAL_DELAY * Math.pow(2, retryCount);
        setRetryCount(prev => prev + 1);
        setLastFailedMessage(messageToSend);
        toast.error(errorMsg, {
          description: `Retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`,
          duration: delay,
        });
        await sleep(delay);
        handleSend(messageToSend, true);
        return;
      }
      
      // Final failure after retries
      setLastFailedMessage(messageToSend);
      toast.error(errorMsg, {
        description: retryCount > 0 ? "All retry attempts failed." : "Click retry to try again.",
        action: {
          label: "Retry",
          onClick: () => {
            setRetryCount(0);
            handleSend(messageToSend, true);
          },
        },
        duration: 10000,
      });
      console.error("Message send failed:", { error, retryCount, messageToSend: messageToSend.substring(0, 50) });
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      if (!lastFailedMessage) setRetryCount(0);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      toast.info("Response generation stopped");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoiceToggle = () => {
    triggerHaptic("medium");
    if (isListening) {
      stopListening();
    } else {
      resetTranscript();
      setInput("");
      startListening();
    }
  };

  const handleAuthSuccess = async () => {
    setShowAuthModal(false);
    if (pendingMessage) {
      // Wait for auth state to be fully updated before sending
      const checkAndSend = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          // Pass user directly to avoid stale state
          handleSendWithUser(pendingMessage, session.user);
          setPendingMessage(null);
        } else {
          // Retry after a short delay if session not ready
          setTimeout(checkAndSend, 100);
        }
      };
      checkAndSend();
    }
  };

  const handleSendWithUser = async (messageToSend: string, authUser: { id: string; email?: string }) => {
    if (!messageToSend || loading) return;
    
    triggerHaptic("medium");
    setInput("");
    resetTranscript();
    setLoading(true);
    setIsUserNearBottom(true); // Resume auto-scroll when user sends message
    setFollowUpSuggestions([]); // Clear follow-up suggestions when sending new message

    // Optimistically add user message to UI immediately
    const tempUserMsgId = `temp-user-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempUserMsgId,
      role: "user",
      content: messageToSend,
      created_at: new Date().toISOString()
    }]);

    try {
      let currentConversationId = conversationId;

      if (!currentConversationId) {
        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({ title: messageToSend.slice(0, 50), user_id: authUser.id })
          .select()
          .single();

        if (convError) throw convError;
        currentConversationId = newConv.id;
        onConversationCreated(currentConversationId);
        
        // Log conversation creation
        await supabase.from("audit_logs").insert({
          user_id: authUser.id,
          conversation_id: currentConversationId,
          event_type: "conversation_created",
          metadata: { title: messageToSend.slice(0, 50) },
        });
      }

      const { error: msgError } = await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "user",
        content: messageToSend,
        user_id: authUser.id,
        user_email: authUser.email,
      });

      if (msgError) throw msgError;

      // Use fetch for true streaming
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
      const response = await fetch(`${supabaseUrl}/functions/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ message: messageToSend, conversationId: currentConversationId }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";
      const steps: string[] = [];
      let buffer = "";
      
      setStreamingMessage({ role: "assistant", content: "", isStreaming: true, steps: [] });

      // Pre-fetch: Start user-message-only follow-up call during streaming
      console.log("Pre-fetching follow-ups (user-only) during stream");
      setFollowUpLoading(true);
      const userOnlyPromise = supabase.functions.invoke('generate-followups', {
        body: { lastUserMessage: messageToSend, userMessageOnly: true }
      }).then(({ data, error }) => {
        console.log("User-only follow-ups received:", { suggestions: data?.suggestions?.length, error });
        return { data, error, source: 'user-only' as const };
      }).catch(err => {
        console.error("User-only follow-ups failed:", err);
        return { data: null, error: err, source: 'user-only' as const };
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const text = buffer + chunk;
        buffer = "";
        
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          if (i === lines.length - 1 && !text.endsWith('\n')) {
            buffer = line;
            continue;
          }

          try {
            const parsed = JSON.parse(line);
            
            if (parsed.type === "item" && parsed.content) {
              fullContent += parsed.content;
              setStreamingMessage({ 
                role: "assistant", 
                content: fullContent, 
                isStreaming: true,
                steps 
              });
            } else if (parsed.type === "step" || parsed.type === "tool" || parsed.type === "thinking") {
              const stepText = parsed.text || parsed.name || parsed.content || JSON.stringify(parsed);
              steps.push(stepText);
              setStreamingMessage(prev => prev ? { 
                ...prev, 
                steps: [...(prev.steps || []), stepText] 
              } : null);
            } else if (parsed.type === "agent" && parsed.text) {
              steps.push(parsed.text);
              setStreamingMessage(prev => prev ? { 
                ...prev, 
                steps: [...(prev.steps || []), parsed.text] 
              } : null);
            }
          } catch {
            console.warn("Failed to parse NDJSON line:", line.substring(0, 50));
          }
        }
      }

      setStreamingMessage({ role: "assistant", content: fullContent, isStreaming: false, steps });
      
      const tempId = `temp-${Date.now()}`;
      setMessages(prev => [...prev, {
        id: tempId,
        role: "assistant",
        content: fullContent,
        created_at: new Date().toISOString()
      }]);
      
      setStreamingMessage(null);

      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: fullContent,
        user_id: authUser.id,
        user_email: authUser.email,
      });

      // Generate follow-up suggestions with parallel calls and smart fallback
      console.log("Generating follow-ups (full-context) - streaming completed");
      
      // Full-context call (higher quality but slower)
      const fullContextPromise = supabase.functions.invoke('generate-followups', {
        body: { 
          lastUserMessage: messageToSend, 
          lastAIResponse: fullContent.substring(0, 1500),
        }
      }).then(({ data, error }) => {
        console.log("Full-context follow-ups received:", { suggestions: data?.suggestions?.length, error });
        return { data, error, source: 'full-context' as const };
      }).catch(err => {
        console.error("Full-context follow-ups failed:", err);
        return { data: null, error: err, source: 'full-context' as const };
      });

      // Race: Wait max 2 seconds for full-context, otherwise use pre-fetched user-only
      const timeoutPromise = new Promise<{ timeout: true }>(resolve => 
        setTimeout(() => resolve({ timeout: true }), 2000)
      );

      // First, try to get full-context within 2 seconds
      const raceResult = await Promise.race([fullContextPromise, timeoutPromise]);
      
      let finalSuggestions: {label: string; prompt: string}[] = [];
      let usedSource = 'none';

      if ('timeout' in raceResult) {
        // Full-context took too long, use user-only result
        console.log("Full-context timeout (2s), using pre-fetched user-only");
        const userOnlyResult = await userOnlyPromise;
        if (userOnlyResult.data?.suggestions?.length > 0) {
          finalSuggestions = userOnlyResult.data.suggestions;
          usedSource = 'user-only (timeout fallback)';
        }
        // Still wait for full-context in background and update if better
        fullContextPromise.then(async (result) => {
          if (result.data?.suggestions?.length > 0) {
            console.log("Full-context arrived late, updating suggestions");
            setFollowUpSuggestions(result.data.suggestions);
            // Persist the better suggestions
            if (currentConversationId) {
              const { data: lastMsg } = await supabase
                .from("messages")
                .select("id")
                .eq("conversation_id", currentConversationId)
                .eq("role", "assistant")
                .order("created_at", { ascending: false })
                .limit(1)
                .single();
              
              if (lastMsg) {
                await supabase
                  .from("messages")
                  .update({ follow_up_suggestions: result.data.suggestions })
                  .eq("id", lastMsg.id);
              }
            }
          }
        });
      } else {
        // Full-context arrived in time
        if (raceResult.data?.suggestions?.length > 0) {
          finalSuggestions = raceResult.data.suggestions;
          usedSource = 'full-context';
        } else {
          // Full-context failed, try user-only
          const userOnlyResult = await userOnlyPromise;
          if (userOnlyResult.data?.suggestions?.length > 0) {
            finalSuggestions = userOnlyResult.data.suggestions;
            usedSource = 'user-only (full-context failed)';
          }
        }
      }

      console.log("Follow-ups resolved:", { count: finalSuggestions.length, source: usedSource });
      setFollowUpSuggestions(finalSuggestions);
      setFollowUpLoading(false);
      
      // Persist follow-ups to the assistant message
      if (finalSuggestions.length > 0 && currentConversationId) {
        const { data: lastMsg } = await supabase
          .from("messages")
          .select("id")
          .eq("conversation_id", currentConversationId)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        
        if (lastMsg) {
          await supabase
            .from("messages")
            .update({ follow_up_suggestions: finalSuggestions })
            .eq("id", lastMsg.id);
        }
      }
    } catch (error: any) {
      setStreamingMessage(null);
      const errorMsg = getErrorMessage(error, error?.status);
      
      // Handle retry logic
      if (retryCount < MAX_RETRIES && !error?.message?.includes("RLS") && !error?.message?.includes("401")) {
        const delay = INITIAL_DELAY * Math.pow(2, retryCount);
        setRetryCount(prev => prev + 1);
        setLastFailedMessage(messageToSend);
        toast.error(errorMsg, {
          description: `Retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`,
          duration: delay,
        });
        await sleep(delay);
        handleSendWithUser(messageToSend, authUser);
        return;
      }
      
      // Final failure after retries
      setLastFailedMessage(messageToSend);
      toast.error(errorMsg, {
        description: retryCount > 0 ? "All retry attempts failed." : "Click retry to try again.",
        action: {
          label: "Retry",
          onClick: () => {
            setRetryCount(0);
            handleSendWithUser(messageToSend, authUser);
          },
        },
        duration: 10000,
      });
      console.error("Message send failed (auth):", { error, retryCount, messageToSend: messageToSend.substring(0, 50) });
    } finally {
      setLoading(false);
      if (!lastFailedMessage) setRetryCount(0);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen min-w-0 bg-background">
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => {
          setShowAuthModal(false);
          setPendingMessage(null);
        }} 
        onSuccess={handleAuthSuccess} 
      />
      {/* Top right controls - Share (chat only) + Profile */}
      {user && (
        <div className="absolute top-8 right-4 z-30 flex items-center gap-2">
          {/* Share button - only in chat view */}
          {conversationId && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShareDialogOpen(true)}
                    className="flex items-center justify-center h-9 w-9 rounded-full hover:bg-accent transition-colors bg-card border border-border shadow-sm"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Share conversation</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {/* Profile dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-center h-9 w-9 rounded-full hover:bg-accent transition-colors bg-card border border-border shadow-sm">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs">
                    {user?.email?.charAt(0).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">
                  {user?.user_metadata?.display_name || user?.email?.split("@")[0] || "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()} className="text-destructive focus:text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {messages.length === 0 && !conversationId ? (
        <div className="flex-1 flex flex-col items-center justify-center px-5 md:px-6 pt-14 md:pt-0 relative overflow-hidden bg-background">
          {/* Subtle gradient background */}
          <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.03)_0%,hsl(256_100%_68%/0.04)_50%,hsl(195_100%_65%/0.03)_100%)]" />
          <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/3 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-aqua/3 rounded-full blur-3xl" />
          <h1 className="relative z-10 text-2xl md:text-3xl lg:text-4xl font-bold mb-3 text-center animate-fade-in px-2 flex items-center justify-center gap-3">
            <EchoLogo size="lg" />
            <span>Echo — Bringing the Voice of Customers Back to You</span>
          </h1>
          <p className="relative z-10 text-muted-foreground mb-10 text-center text-sm md:text-base animate-fade-in [animation-delay:100ms] opacity-0 [animation-fill-mode:forwards]">Our customers are talking. Echo remembers.</p>
          <div className="relative z-10 w-full max-w-2xl px-4">
            {/* Gradient glow behind input */}
            <div className="absolute -inset-1.5 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.25)_0%,hsl(256_100%_68%/0.15)_50%,hsl(195_100%_65%/0.25)_100%)] rounded-[2rem] blur-xl opacity-50" />
            <div className={`relative flex items-center gap-3 bg-background/90 backdrop-blur-sm border rounded-3xl px-4 md:px-5 py-3.5 transition-all shadow-sm ${isListening ? 'border-red-500 bg-red-500/10' : 'border-border/80'}`}>
                <div className="flex-1 relative min-h-[26px] flex items-center">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => handleInputChange(e, textareaRef)}
                    onKeyDown={handleKeyDown}
                    placeholder={isListening ? "Listening..." : ""}
                    className="w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground resize-none min-h-[26px] max-h-[200px] py-0 text-[15px] leading-[26px]"
                    rows={1}
                  />
                  {!input && !isListening && (
                    <div className="absolute inset-0 flex items-center pointer-events-none">
                      <AnimatedPlaceholder text="Ask Echo — it knows" isVisible={!input && !isListening} />
                    </div>
                  )}
                </div>
              <div className="flex items-center gap-2.5">
                {isSupported && (
                  <button 
                    onClick={handleVoiceToggle}
                    className={`transition-colors p-1 ${isListening ? 'text-red-500 animate-pulse' : 'text-muted-foreground hover:text-foreground'}`}
                    title={isListening ? "Stop listening" : "Start voice input"}
                  >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                )}
                {loading ? (
                  <button 
                    onClick={handleStop}
                    className="bg-destructive text-destructive-foreground rounded-full p-2.5 hover:opacity-80 transition-all"
                    title="Stop generating"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                ) : (
                  <button 
                    onClick={() => handleSend()}
                    disabled={!input.trim()}
                    className="bg-foreground text-background rounded-full p-2.5 hover:opacity-80 transition-all disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            {isListening && (
              <p className="text-center text-sm text-muted-foreground mt-4 animate-pulse">
                Speak now... Click the mic to stop.
              </p>
            )}
            {/* Dynamic suggestion pills */}
            <DynamicSuggestionPills onSelect={(prompt) => {
              setInput(prompt);
              setTimeout(() => textareaRef2.current?.focus(), 0);
            }} />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col relative overflow-hidden bg-background">
          {/* Subtle gradient background - same as welcome screen */}
          <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.03)_0%,hsl(256_100%_68%/0.04)_50%,hsl(195_100%_65%/0.03)_100%)]" />
          <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/3 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-aqua/3 rounded-full blur-3xl" />
          
          {/* Conversation Header - title only */}
          {conversationId && (
            <div className="absolute top-0 left-0 right-0 z-20 h-25 flex items-center bg-background/80 backdrop-blur-sm border-b border-border">
              <div className="w-full px-4 pl-16 pr-28">
                <h2 className="font-medium text-sm truncate max-w-3xl mx-auto">{conversationTitle || "Conversation"}</h2>
              </div>
            </div>
          )}
          
          <ScrollArea className={`flex-1 px-4 md:px-6 py-5 ${conversationId ? 'pt-28' : 'pt-5'} relative z-10`} viewportRef={scrollContainerRef} onScrollCapture={handleScroll}>
            <div className="space-y-6 max-w-3xl mx-auto pb-8">
              {messagesLoading && messages.length === 0 ? (
                <div className="space-y-6 animate-pulse">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className={`flex gap-3 ${i % 2 === 1 ? 'justify-end' : 'justify-start'}`}>
                      {i % 2 === 0 && <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />}
                      <div className={`${i % 2 === 1 ? 'max-w-[60%]' : 'max-w-[70%]'}`}>
                        <div className="rounded-2xl px-4 py-3 bg-muted/50 h-16" />
                      </div>
                      {i % 2 === 1 && <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              ) : messages.map((msg) => (
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
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy message"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-green-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="bg-muted text-xs font-medium">
                          {getUserInitials(user?.user_metadata?.display_name)}
                        </AvatarFallback>
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
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy response"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3.5 h-3.5 text-green-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {streamingMessage && (
                <div className="flex justify-start gap-3">
                  <EchoLogo size="md" className="mt-0.5" />
                  <div className="flex-1 space-y-3 min-w-0">
                    {/* Intermediate steps */}
                    {streamingMessage.steps && streamingMessage.steps.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {streamingMessage.steps.map((step, idx) => (
                          <span 
                            key={idx} 
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-primary/10 text-primary border border-primary/20 animate-fade-in"
                          >
                            <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse"></span>
                            {step}
                          </span>
                        ))}
                      </div>
                    )}
                    <MarkdownRenderer content={streamingMessage.content + (streamingMessage.isStreaming ? "▋" : "")} />
                  </div>
                </div>
              )}
              {loading && !streamingMessage && (
                <div className="flex justify-start gap-3 py-2">
                  <EchoLogo size="md" />
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 bg-muted-foreground/70 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-2 h-2 bg-muted-foreground/70 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-2 h-2 bg-muted-foreground/70 rounded-full animate-bounce"></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          {/* Scroll to bottom button */}
          {!isUserNearBottom && (
            <button
              onClick={() => {
                scrollRef.current?.scrollIntoView({ behavior: "smooth" });
                setIsUserNearBottom(true);
              }}
              className="absolute bottom-28 left-1/2 -translate-x-1/2 z-20 bg-background/90 backdrop-blur-sm border border-border rounded-full p-2 shadow-lg hover:bg-accent transition-all animate-fade-in"
              title="Scroll to bottom"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          )}

          <div className="p-4 md:p-6 pb-8 md:pb-10 bg-transparent relative z-10">
            <div className="max-w-3xl mx-auto relative px-1">
              {/* Follow-up suggestion pills - above input with divider */}
              {!loading && !streamingMessage && (followUpSuggestions.length > 0 || followUpLoading) && (
                <div className="mb-3 relative z-20">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="flex-1 h-px bg-border/50" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Ask Follow-Up</span>
                    <div className="flex-1 h-px bg-border/50" />
                  </div>
                  <FollowUpPills 
                    suggestions={followUpSuggestions} 
                    onSelect={(prompt) => {
                      // Don't clear suggestions - let user iterate and choose
                      setInput(prompt);
                      setTimeout(() => textareaRef.current?.focus(), 0);
                    }} 
                    loading={followUpLoading}
                  />
                </div>
              )}
              {/* Gradient glow behind input */}
              <div className="absolute -inset-1.5 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.25)_0%,hsl(256_100%_68%/0.15)_50%,hsl(195_100%_65%/0.25)_100%)] rounded-[2rem] blur-xl opacity-50 pointer-events-none" />
              <div className={`relative z-10 flex items-center gap-3 bg-background/90 backdrop-blur-sm border rounded-3xl px-4 md:px-5 py-3.5 transition-all shadow-sm ${isListening ? 'border-red-500 bg-red-500/10' : 'border-border/80'}`}>
                <div className="flex-1 relative min-h-[26px] flex items-center">
                  <textarea
                    ref={textareaRef2}
                    value={input}
                    onChange={(e) => handleInputChange(e, textareaRef2)}
                    onKeyDown={handleKeyDown}
                    placeholder={isListening ? "Listening..." : ""}
                    className="w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground resize-none min-h-[26px] max-h-[200px] py-0 text-[15px] leading-[26px]"
                    rows={1}
                  />
                  {!input && !isListening && (
                    <div className="absolute inset-0 flex items-center pointer-events-none">
                      <AnimatedPlaceholder text="Ask Echo — it knows" isVisible={!input && !isListening} />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  {isSupported && (
                    <button 
                      onClick={handleVoiceToggle}
                      className={`transition-colors p-1 ${isListening ? 'text-red-500 animate-pulse' : 'text-muted-foreground hover:text-foreground'}`}
                      title={isListening ? "Stop listening" : "Start voice input"}
                    >
                      {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                  )}
                  {loading ? (
                    <button 
                      onClick={handleStop}
                      className="bg-destructive text-destructive-foreground rounded-full p-2.5 hover:opacity-80 transition-all"
                      title="Stop generating"
                    >
                      <Square className="w-4 h-4 fill-current" />
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleSend()}
                      disabled={!input.trim()}
                      className="bg-foreground text-background rounded-full p-2.5 hover:opacity-80 transition-all disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
              {isListening && (
                <p className="text-center text-sm text-muted-foreground mt-4 animate-pulse">
                  Speak now... Click the mic to stop.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Share Dialog */}
      {conversationId && (
        <ShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          conversationId={conversationId}
          conversationTitle={conversationTitle || "Conversation"}
        />
      )}
      
      {/* Footer credit */}
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <a 
              href="mailto:ayush.sharma@saaslabs.co?subject=Great%20job%20on%20Echo!&body=Hey%20Ayush,%0A%0AJust%20wanted%20to%20say%20you%20did%20a%20great%20job%20building%20Echo!%0A%0ACheers!"
              className="group fixed bottom-2 right-3 z-20 text-[10px] text-muted-foreground/50 hover:text-muted-foreground hover:scale-110 hover:animate-nudge transition-all duration-300 cursor-pointer"
            >
              Made with <span className="inline-block group-hover:animate-pulse">♥️</span> Ayush
            </a>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Click to say thanks! 💌
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
};

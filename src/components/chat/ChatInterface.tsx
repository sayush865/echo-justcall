import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import { Mic, MicOff, Send, Copy, Check, ArrowDown, Share2, LogOut, Square, LogIn } from "lucide-react";
import { toast } from "sonner";
import { MemoizedMarkdownRenderer, MarkdownRenderer } from "./MarkdownRenderer";
import { parseCitations, extractTypeFromToolName } from "@/lib/citationParser";
import type { PreloadedSource } from "@/lib/citationParser";
import { triggerHaptic } from "@/hooks/useHapticFeedback";
import { AnimatedPlaceholder } from "./AnimatedPlaceholder";
import { useAuth } from "@/hooks/useAuth";
import { AuthModal } from "@/components/auth/AuthModal";
import { EchoLogo } from "./EchoLogo";
import { EchoLoadingIndicator } from "./EchoLoadingIndicator";
import { ShareDialog } from "./ShareDialog";
import { FeedbackDialog } from "./FeedbackDialog";
import { DynamicSuggestionPills } from "./DynamicSuggestionPills";
import { FollowUpPills } from "./FollowUpPills";
import { MessageItem } from "./MessageItem";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Import custom hooks
import { useChatMessages } from "@/hooks/useChatMessages";
import { useChatStreaming } from "@/hooks/useChatStreaming";
import { useBackgroundContinuation } from "@/hooks/useBackgroundContinuation";
import { useFollowUps } from "@/hooks/useFollowUps";
import { useChatInput } from "@/hooks/useChatInput";
import { useChatScroll } from "@/hooks/useChatScroll";

// Import shared types and utils
import { 
  getUserInitials, 
  formatMessageTime, 
  getErrorMessage, 
  MAX_RETRIES, 
  INITIAL_DELAY, 
  sleep 
} from "@/types/chat";

interface ChatInterfaceProps {
  conversationId: string | null;
  conversationTitle?: string;
  onTitleChange?: (title: string) => void;
}

export const ChatInterface = ({
  conversationId,
  conversationTitle = "",
  onTitleChange,
}: ChatInterfaceProps) => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  
  // Refs
  const activeConversationRef = useRef<string | null>(null);
  const sendInProgressRef = useRef<string | null>(null);
  const lastSentMessageRef = useRef<{ content: string; timestamp: number } | null>(null);
  const toolSourceMapRef = useRef<Map<number, PreloadedSource>>(new Map());
  
  // Local state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  // Custom hooks
  const {
    messages,
    setMessages,
    messagesLoading,
    followUpSuggestions,
    setFollowUpSuggestions,
    loadMessages,
    addOptimisticMessage,
    clearMessages,
    getCachedData,
    updateCache,
    messagesCacheRef,
  } = useChatMessages({ conversationId, activeConversationRef });

  const {
    loading,
    setLoading,
    streamingMessage,
    setStreamingMessage,
    streamingSourceCount,
    setStreamingSourceCount,
    streamingConversationId,
    isStreamingRef,
    streamingConversationIdRef,
    abortControllerRef,
    preWarmFollowUpRef,
    startStreaming,
    stopStreaming,
    resetForConversation,
  } = useChatStreaming();

  const {
    input,
    setInput,
    textareaRef,
    textareaRef2,
    isListening,
    isSupported,
    handleInputChange,
    clearInput,
    handleVoiceToggle: rawVoiceToggle,
    focusInput,
    resetTranscript,
  } = useChatInput();

  const {
    isUserNearBottom,
    scrollRef,
    scrollContainerRef,
    handleScroll,
    scrollToBottom,
    resumeAutoScroll,
  } = useChatScroll({ messages, streamingMessage });

  const {
    followUpLoading,
    startPreWarm,
    generateFollowUps,
    clearFollowUps,
  } = useFollowUps({ messagesCacheRef, setFollowUpSuggestions });

  const { checkPendingResponse } = useBackgroundContinuation({
    conversationId,
    activeConversationRef,
    isStreamingRef,
    streamingConversationIdRef,
    abortControllerRef,
    streamingMessage,
    setStreamingMessage,
    setStreamingConversationId: (id) => {}, // Handled by streaming hook
    setLoading,
    setMessages,
    loadMessages,
  });

  // Handle voice toggle with haptic
  const handleVoiceToggle = () => {
    triggerHaptic("medium");
    rawVoiceToggle();
  };

  // Handle copy
  const handleCopy = async (content: string, id: string) => {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Conversation switch effect
  useEffect(() => {
    activeConversationRef.current = conversationId;
    
    const isStreamingThisConversation = streamingConversationIdRef.current === conversationId;
    const isSendingToThisConversation = sendInProgressRef.current === conversationId || 
                                         (sendInProgressRef.current === 'new' && conversationId);
    
    resetForConversation(conversationId, !!isSendingToThisConversation);
    setRetryCount(0);
    setLastFailedMessage(null);
    
    if (conversationId) {
      const cached = getCachedData(conversationId);
      if (cached) {
        setMessages(cached.messages);
        setFollowUpSuggestions(cached.followUps);
        loadMessages(true);
      } else if (!isSendingToThisConversation) {
        clearMessages();
        loadMessages(false);
      }
      
      setTimeout(() => checkPendingResponse(), 100);
    } else {
      clearMessages();
    }
  }, [conversationId]);

  // Main send handler
  const handleSend = async (messageOverride?: string, skipAuthCheck?: boolean) => {
    const messageToSend = messageOverride || input.trim();
    if (!messageToSend || loading) return;
    
    // Check auth FIRST before acquiring lock - this is a UX flow redirection
    if (!user && !skipAuthCheck) {
      setPendingMessage(messageToSend);
      setShowAuthModal(true);
      toast.info("Sign in to send your message", { description: "Your message is queued and will be sent after you sign in." });
      return;
    }
    
    if (sendInProgressRef.current) return;
    
    if (lastSentMessageRef.current && 
        lastSentMessageRef.current.content === messageToSend &&
        Date.now() - lastSentMessageRef.current.timestamp < 5000) {
      return;
    }
    
    sendInProgressRef.current = conversationId || 'new';
    
    triggerHaptic("medium");
    clearInput();
    setLoading(true);
    resumeAutoScroll();
    clearFollowUps();
    
    lastSentMessageRef.current = { content: messageToSend, timestamp: Date.now() };
    
    // Start streaming UI
    isStreamingRef.current = true;
    streamingConversationIdRef.current = conversationId || 'new';
    setStreamingSourceCount(0);
    toolSourceMapRef.current = new Map();
    setStreamingMessage({ role: "assistant", content: "", isStreaming: true, steps: [] });

    // Optimistic user message
    const tempUserMsgId = `temp-user-${Date.now()}`;
    addOptimisticMessage({
      id: tempUserMsgId,
      role: "user",
      content: messageToSend,
      created_at: new Date().toISOString()
    });

    let currentConversationId = conversationId;
    let fullContent = "";

    try {
      if (!currentConversationId) {
        const placeholderTitle = "New conversation";
        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({ title: placeholderTitle, user_id: user?.id })
          .select()
          .single();

        if (convError) throw convError;
        currentConversationId = newConv.id;
        navigate(`/c/${currentConversationId}`);
        
        await supabase.from("audit_logs").insert({
          user_id: user?.id,
          conversation_id: currentConversationId,
          event_type: "conversation_created",
          metadata: { title: placeholderTitle },
        });

        const convIdForTitle = currentConversationId;
        supabase.functions.invoke('generate-title', {
          body: { userMessage: messageToSend }
        }).then(async ({ data }) => {
          if (data?.title && data.title !== placeholderTitle) {
            await supabase.from("conversations")
              .update({ title: data.title })
              .eq("id", convIdForTitle);
            onTitleChange?.(data.title);
          }
        }).catch(() => {
          supabase.from("conversations")
            .update({ title: messageToSend.slice(0, 40) })
            .eq("id", convIdForTitle);
        });
      }

      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "user",
        content: messageToSend,
        user_id: user?.id,
        user_email: user?.email,
      });

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
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

      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      fullContent = "";
      const steps: string[] = [];
      let buffer = "";
      
      const isActiveConversation = () => activeConversationRef.current === currentConversationId;
      
      startPreWarm(messageToSend);
      
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
              if (isActiveConversation()) {
                setStreamingMessage({ 
                  role: "assistant", 
                  content: fullContent, 
                  isStreaming: true,
                  steps 
                });
              }
            } else if (parsed.type === "step" || parsed.type === "tool" || parsed.type === "thinking") {
              const stepText = parsed.text || parsed.name || parsed.content || JSON.stringify(parsed);
              steps.push(stepText);
              
              if (parsed.type === "tool" && parsed.toolName && parsed.result) {
                try {
                  const toolName = parsed.toolName as string;
                  const sourceType = extractTypeFromToolName(toolName);
                  
                  const resultData = typeof parsed.result === "string" 
                    ? JSON.parse(parsed.result) 
                    : parsed.result;
                  
                  const extractIds = (data: any): string[] => {
                    const ids: string[] = [];
                    if (Array.isArray(data)) {
                      data.forEach(item => {
                        const id = item?.callSID || item?.instanceId || item?.metadata?.callSID || item?.metadata?.instanceId || item?.id;
                        if (id && typeof id === "string") ids.push(id);
                      });
                    } else if (data?.matches) {
                      data.matches.forEach((match: any) => {
                        const id = match?.metadata?.callSID || match?.metadata?.instanceId || match?.id;
                        if (id && typeof id === "string") ids.push(id);
                      });
                    }
                    return ids;
                  };
                  
                  const foundIds = extractIds(resultData);
                  foundIds.forEach(id => {
                    const nextNum = toolSourceMapRef.current.size + 1;
                    const alreadyExists = Array.from(toolSourceMapRef.current.values()).some(s => s.id === id);
                    if (!alreadyExists) {
                      toolSourceMapRef.current.set(nextNum, { id, type: sourceType });
                    }
                  });
                } catch {}
              }
              
              if (isActiveConversation()) {
                setStreamingMessage(prev => prev ? { 
                  ...prev, 
                  steps: [...(prev.steps || []), stepText] 
                } : null);
              }
            } else if (parsed.type === "agent" && parsed.text) {
              steps.push(parsed.text);
              if (isActiveConversation()) {
                setStreamingMessage(prev => prev ? { 
                  ...prev, 
                  steps: [...(prev.steps || []), parsed.text] 
                } : null);
              }
            }
          } catch {}
        }
      }

      // Streaming complete
      isStreamingRef.current = false;
      streamingConversationIdRef.current = null;
      setLoading(false);
      
      if (isActiveConversation()) {
        setStreamingMessage({ role: "assistant", content: fullContent, isStreaming: false, steps });
        
        const tempId = `temp-${Date.now()}`;
        setMessages(prev => [...prev, {
          id: tempId,
          role: "assistant",
          content: fullContent,
          created_at: new Date().toISOString()
        }]);
        
        setStreamingMessage(null);
      } else {
        setStreamingMessage(null);
      }

      // Fire-and-forget: save message and generate follow-ups
      const savedMessageToSend = messageToSend;
      const savedFullContent = fullContent;
      const savedConversationId = currentConversationId;
      
      (async () => {
        try {
          const { data: insertedMsg } = await supabase.from("messages").insert({
            conversation_id: savedConversationId,
            role: "assistant",
            content: savedFullContent,
            user_id: user?.id,
            user_email: user?.email,
          }).select('id').single();
          
          await generateFollowUps(
            savedMessageToSend, 
            savedFullContent, 
            savedConversationId!, 
            insertedMsg?.id
          );
        } catch (err) {
          console.error("Background save failed:", err);
        }
      })();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        if (fullContent) {
          const tempId = `partial-${Date.now()}`;
          setMessages(prev => [...prev, {
            id: tempId,
            role: "assistant",
            content: fullContent,
            created_at: new Date().toISOString()
          }]);
          
          await supabase.from("messages").insert({
            conversation_id: currentConversationId,
            role: "assistant",
            content: fullContent,
            user_id: user?.id,
            user_email: user?.email,
          });
          
          if (fullContent.length > 50) {
            generateFollowUps(messageToSend, fullContent, currentConversationId!);
          }
        }
        setStreamingMessage(null);
        toast.info("Response generation stopped", { description: "Partial response saved." });
      } else {
        setStreamingMessage(null);
        const errorMsg = getErrorMessage(error, error?.status);
        
        if (retryCount < MAX_RETRIES && !error?.message?.includes("RLS") && !error?.message?.includes("401")) {
          const delay = INITIAL_DELAY * Math.pow(2, retryCount);
          setRetryCount(prev => prev + 1);
          setLastFailedMessage(messageToSend);
          toast.error(errorMsg.title, {
            description: `${errorMsg.description || ''} Retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`,
            duration: delay,
          });
          await sleep(delay);
          handleSend(messageToSend, true);
          return;
        }
        
        setLastFailedMessage(messageToSend);
        toast.error(errorMsg.title, {
          description: errorMsg.description || (retryCount > 0 ? "All retry attempts failed." : "Click retry to try again."),
          action: {
            label: "Retry",
            onClick: () => {
              setRetryCount(0);
              handleSend(messageToSend, true);
            },
          },
          duration: 10000,
        });
      }
    } finally {
      sendInProgressRef.current = null;
      if (isStreamingRef.current) {
        isStreamingRef.current = false;
        streamingConversationIdRef.current = null;
        setLoading(false);
      }
      abortControllerRef.current = null;
      if (!lastFailedMessage) setRetryCount(0);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current && streamingConversationIdRef.current === conversationId) {
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

  const handleAuthSuccess = async () => {
    setShowAuthModal(false);
    if (pendingMessage) {
      const checkAndSend = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          handleSendWithUser(pendingMessage, session.user);
          setPendingMessage(null);
        } else {
          setTimeout(checkAndSend, 100);
        }
      };
      checkAndSend();
    }
  };

  const handleSendWithUser = async (messageToSend: string, authUser: { id: string; email?: string }) => {
    if (!messageToSend || loading) return;
    
    if (lastSentMessageRef.current && 
        lastSentMessageRef.current.content === messageToSend &&
        Date.now() - lastSentMessageRef.current.timestamp < 5000) {
      return;
    }
    
    triggerHaptic("medium");
    clearInput();
    setLoading(true);
    resumeAutoScroll();
    clearFollowUps();
    
    sendInProgressRef.current = conversationId || 'new';
    lastSentMessageRef.current = { content: messageToSend, timestamp: Date.now() };
    
    isStreamingRef.current = true;
    streamingConversationIdRef.current = conversationId || 'new';
    setStreamingSourceCount(0);
    setStreamingMessage({ role: "assistant", content: "", isStreaming: true, steps: [] });

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
        navigate(`/c/${currentConversationId}`);
        
        await supabase.from("audit_logs").insert({
          user_id: authUser.id,
          conversation_id: currentConversationId,
          event_type: "conversation_created",
          metadata: { title: messageToSend.slice(0, 50) },
        });
      }

      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "user",
        content: messageToSend,
        user_id: authUser.id,
        user_email: authUser.email,
      });

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      
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

      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";
      const steps: string[] = [];
      let buffer = "";

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
          } catch {}
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
      
      isStreamingRef.current = false;
      streamingConversationIdRef.current = null;
      setLoading(false);

      // Fire-and-forget
      const savedMessageToSend = messageToSend;
      const savedFullContent = fullContent;
      const savedConversationId = currentConversationId;

      (async () => {
        try {
          await supabase.from("messages").insert({
            conversation_id: savedConversationId,
            role: "assistant",
            content: savedFullContent,
            user_id: authUser.id,
            user_email: authUser.email,
          });

          await generateFollowUps(savedMessageToSend, savedFullContent, savedConversationId!);
        } catch (err) {
          console.error("Background follow-up generation failed:", err);
        }
      })();
    } catch (error: any) {
      setStreamingMessage(null);
      const errorMsg = getErrorMessage(error, error?.status);
      
      if (retryCount < MAX_RETRIES && !error?.message?.includes("RLS") && !error?.message?.includes("401")) {
        const delay = INITIAL_DELAY * Math.pow(2, retryCount);
        setRetryCount(prev => prev + 1);
        setLastFailedMessage(messageToSend);
        toast.error(errorMsg.title, {
          description: `${errorMsg.description || ''} Retrying in ${delay / 1000}s... (${retryCount + 1}/${MAX_RETRIES})`,
          duration: delay,
        });
        await sleep(delay);
        handleSendWithUser(messageToSend, authUser);
        return;
      }
      
      setLastFailedMessage(messageToSend);
      toast.error(errorMsg.title, {
        description: errorMsg.description || (retryCount > 0 ? "All retry attempts failed." : "Click retry to try again."),
        action: {
          label: "Retry",
          onClick: () => {
            setRetryCount(0);
            handleSendWithUser(messageToSend, authUser);
          },
        },
        duration: 10000,
      });
    } finally {
      sendInProgressRef.current = null;
      if (isStreamingRef.current) {
        isStreamingRef.current = false;
        streamingConversationIdRef.current = null;
        setLoading(false);
      }
      if (!lastFailedMessage) setRetryCount(0);
    }
  };

  // Render input area (used in both welcome and chat views)
  const renderInputArea = (textareaRefToUse: React.RefObject<HTMLTextAreaElement>) => (
    <div className={`relative flex items-center gap-2 md:gap-3 bg-background/90 backdrop-blur-sm border rounded-2xl md:rounded-3xl px-3 md:px-5 py-3 md:py-3.5 transition-all shadow-sm ${isListening ? 'border-red-500 bg-red-500/10' : 'border-border/80'}`}>
      <div className="flex-1 relative min-h-[26px] flex items-center">
        <textarea
          ref={textareaRefToUse}
          value={input}
          onChange={(e) => handleInputChange(e, textareaRefToUse)}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? "Listening..." : ""}
          className="w-full bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground resize-none min-h-[26px] max-h-[200px] py-0 text-sm md:text-[15px] leading-[26px]"
          rows={1}
        />
        {!input && !isListening && (
          <div className="absolute inset-0 flex items-center pointer-events-none">
            <AnimatedPlaceholder text="Ask Echo — it knows" isVisible={!input && !isListening} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 md:gap-2.5 self-end">
        {isSupported && (
          <button 
            onClick={handleVoiceToggle}
            className={`transition-colors p-1 ${isListening ? 'text-red-500 animate-pulse' : 'text-muted-foreground hover:text-foreground'}`}
            title={isListening ? "Stop listening" : "Start voice input"}
          >
            {isListening ? <MicOff className="w-4 h-4 md:w-5 md:h-5" /> : <Mic className="w-4 h-4 md:w-5 md:h-5" />}
          </button>
        )}
        {loading ? (
          <button 
            onClick={handleStop}
            className="bg-destructive text-destructive-foreground rounded-full p-2 md:p-2.5 hover:opacity-80 transition-all"
            title="Stop generating"
          >
            <Square className="w-3.5 h-3.5 md:w-4 md:h-4 fill-current" />
          </button>
        ) : (
          <button 
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="bg-foreground text-background rounded-full p-2 md:p-2.5 hover:opacity-80 transition-all disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5 md:w-4 md:h-4" />
          </button>
        )}
      </div>
    </div>
  );

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
      
      {/* Top right controls */}
      <div className="absolute top-3 md:top-4 right-3 md:right-4 z-30 flex items-center gap-1.5 md:gap-2">
        {user && conversationId && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShareDialogOpen(true)}
                  className="flex items-center justify-center h-8 w-8 md:h-9 md:w-9 rounded-full hover:bg-accent transition-colors bg-card border border-border shadow-sm"
                >
                  <Share2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent><p>Share this conversation</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center justify-center h-8 w-8 md:h-9 md:w-9 rounded-full hover:bg-accent transition-colors bg-card border border-border shadow-sm">
                <Avatar className="w-6 h-6 md:w-7 md:h-7">
                  <AvatarFallback className="bg-primary/10 text-primary text-[10px] md:text-xs font-medium">
                    {getUserInitials(user.user_metadata?.display_name)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium truncate">{user.user_metadata?.display_name || "User"}</p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="flex items-center justify-center h-8 w-8 md:h-9 md:w-9 rounded-full hover:bg-accent transition-colors bg-card border border-border shadow-sm"
                >
                  <LogIn className="w-3.5 h-3.5 md:w-4 md:h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent><p>Sign in to save conversations</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {messages.length === 0 && !conversationId ? (
        // Welcome screen
        <div className="flex-1 flex flex-col items-center justify-center px-4 md:px-6 pt-16 md:pt-0 relative overflow-hidden bg-background">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.03)_0%,hsl(256_100%_68%/0.04)_50%,hsl(195_100%_65%/0.03)_100%)]" />
          <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/3 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-aqua/3 rounded-full blur-3xl" />
          <div className="relative z-10 text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold mb-3 text-center animate-fade-in px-2 flex flex-col md:flex-row items-center justify-center gap-2 md:gap-3">
            <EchoLogo size="lg" className="flex-shrink-0" />
            <span className="leading-tight">Echo — Bringing the Voice of Customers Back to You</span>
          </div>
          <p className="relative z-10 text-muted-foreground mb-8 md:mb-10 text-center text-xs sm:text-sm md:text-base animate-fade-in [animation-delay:100ms] opacity-0 [animation-fill-mode:forwards] px-4">Our customers are talking. Echo remembers.</p>
          <div className="relative z-10 w-full max-w-2xl px-3 md:px-4">
            <div className="absolute -inset-1 md:-inset-1.5 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.25)_0%,hsl(256_100%_68%/0.15)_50%,hsl(195_100%_65%/0.25)_100%)] rounded-[1.5rem] md:rounded-[2rem] blur-xl opacity-50 pointer-events-none" />
            {renderInputArea(textareaRef)}
            {isListening && (
              <p className="text-center text-xs md:text-sm text-muted-foreground mt-3 md:mt-4 animate-pulse">
                Speak now... Click the mic to stop.
              </p>
            )}
            <DynamicSuggestionPills onSelect={(prompt) => {
              setInput(prompt);
              focusInput(2);
            }} />
          </div>
        </div>
      ) : (
        // Chat view
        <div className="flex-1 flex flex-col relative overflow-hidden bg-background">
          <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.03)_0%,hsl(256_100%_68%/0.04)_50%,hsl(195_100%_65%/0.03)_100%)]" />
          <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/3 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-aqua/3 rounded-full blur-3xl" />
          
          {conversationId && (
            <div className="absolute top-0 left-0 right-0 z-20 h-14 md:h-16 flex items-center bg-background/80 backdrop-blur-sm border-b border-border">
              <div className="w-full px-3 md:px-4 pl-14 md:pl-16 pr-20 md:pr-28">
                <h2 className="font-medium text-xs md:text-sm truncate max-w-3xl mx-auto">{conversationTitle || "Conversation"}</h2>
              </div>
            </div>
          )}
          
          <ScrollArea className="flex-1 relative z-10" viewportRef={scrollContainerRef} onScrollCapture={handleScroll}>
            <div className={`space-y-6 max-w-3xl mx-auto px-3 md:px-6 py-4 md:py-5 pb-8 ${conversationId ? 'pt-18 md:pt-20' : 'pt-4 md:pt-5'}`}>
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
                <MessageItem
                  key={msg.id}
                  message={msg}
                  userDisplayName={user?.user_metadata?.display_name}
                  copiedId={copiedId}
                  onCopy={handleCopy}
                />
              ))}
              {streamingMessage && (
                <div className={`flex justify-start gap-3 ${streamingMessage.isStreaming && !streamingMessage.content ? 'items-center' : ''}`}>
                  <EchoLogo size="md" className={streamingMessage.content ? "mt-0.5" : ""} />
                  <div className="flex-1 space-y-2 min-w-0">
                    {streamingMessage.isStreaming && !streamingMessage.content && <EchoLoadingIndicator asText />}
                    {streamingMessage.isStreaming && streamingSourceCount > 0 && (
                      <p className="text-xs text-muted-foreground animate-fade-in mb-2">
                        Found {streamingSourceCount} source{streamingSourceCount !== 1 ? 's' : ''}
                      </p>
                    )}
                    {(streamingMessage.content || !streamingMessage.isStreaming) && (
                      <MarkdownRenderer 
                        content={streamingMessage.content + (streamingMessage.isStreaming ? "▋" : "")} 
                        isStreaming={streamingMessage.isStreaming}
                        onSourceCount={streamingMessage.isStreaming ? setStreamingSourceCount : undefined}
                        preloadedSources={streamingMessage.isStreaming ? toolSourceMapRef.current : undefined}
                      />
                    )}
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

          {!isUserNearBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-24 md:bottom-28 left-1/2 -translate-x-1/2 z-20 bg-background/90 backdrop-blur-sm border border-border rounded-full p-1.5 md:p-2 shadow-lg hover:bg-accent transition-all animate-fade-in"
              title="Scroll to bottom"
            >
              <ArrowDown className="w-3.5 h-3.5 md:w-4 md:h-4" />
            </button>
          )}

          <div className="p-3 md:p-6 pb-6 md:pb-10 bg-transparent relative z-10">
            <div className="max-w-3xl mx-auto relative px-0 md:px-1">
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
                      setInput(prompt);
                      focusInput(1);
                    }} 
                    loading={followUpLoading}
                  />
                </div>
              )}
              <div className="absolute -inset-1.5 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.25)_0%,hsl(256_100%_68%/0.15)_50%,hsl(195_100%_65%/0.25)_100%)] rounded-[2rem] blur-xl opacity-50 pointer-events-none" />
              <div className="relative z-10">
                {renderInputArea(textareaRef2)}
              </div>
              {isListening && (
                <p className="text-center text-xs md:text-sm text-muted-foreground mt-3 md:mt-4 animate-pulse">
                  Speak now... Click the mic to stop.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Footer */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setFeedbackDialogOpen(true)}
              className="fixed bottom-2 right-3 text-sm text-muted-foreground/60 hover:text-muted-foreground transition-all duration-300 hover:scale-105 z-50 font-medium"
            >
              Made with <span className="text-red-500 animate-pulse inline-block hover:animate-bounce">❤️</span> Ayush
            </button>
          </TooltipTrigger>
          <TooltipContent side="left"><p>Click to share feedback! 💌</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <ShareDialog
        open={shareDialogOpen} 
        onOpenChange={setShareDialogOpen}
        conversationId={conversationId || ""}
        conversationTitle={conversationTitle}
      />
      <FeedbackDialog
        open={feedbackDialogOpen}
        onOpenChange={setFeedbackDialogOpen}
      />
    </div>
  );
};

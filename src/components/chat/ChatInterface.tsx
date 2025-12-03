import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Mic, MicOff, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { triggerHaptic } from "@/hooks/useHapticFeedback";
import { AnimatedPlaceholder } from "./AnimatedPlaceholder";
import { useAuth } from "@/hooks/useAuth";
import { AuthModal } from "@/components/auth/AuthModal";

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
  onConversationCreated: (id: string) => void;
}

export const ChatInterface = ({
  conversationId,
  onConversationCreated,
}: ChatInterfaceProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<StreamingMessage | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef2 = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>, ref: React.RefObject<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 200)}px`;
    }
  };

  // Reset textarea height when input is cleared
  useEffect(() => {
    if (!input) {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      if (textareaRef2.current) {
        textareaRef2.current.style.height = 'auto';
      }
    }
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
    if (conversationId) {
      loadMessages();

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
          () => {
            loadMessages();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setMessages([]);
    }
  }, [conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  const loadMessages = async () => {
    if (!conversationId) return;

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Failed to load messages");
      return;
    }

    setMessages(data || []);
  };

  const handleSend = async (messageOverride?: string, skipAuthCheck?: boolean) => {
    const messageToSend = messageOverride || input.trim();
    if (!messageToSend || loading) return;
    
    // Check auth - if not logged in, show modal and save message
    if (!user && !skipAuthCheck) {
      setPendingMessage(messageToSend);
      setShowAuthModal(true);
      return;
    }
    
    triggerHaptic("medium");
    setInput("");
    resetTranscript();
    setLoading(true);

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
      });

      if (msgError) throw msgError;

      // Use fetch for true streaming instead of supabase.functions.invoke
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
      
      setStreamingMessage({ role: "assistant", content: "", isStreaming: true, steps: [] });

      // Read the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            
            // Handle different event types from n8n
            if (parsed.type === "item" && parsed.content) {
              fullContent += parsed.content;
              setStreamingMessage({ 
                role: "assistant", 
                content: fullContent, 
                isStreaming: true,
                steps 
              });
            } else if (parsed.type === "step" || parsed.type === "tool" || parsed.type === "thinking") {
              // Handle intermediate steps (tool calls, thinking, etc.)
              const stepText = parsed.text || parsed.name || parsed.content || JSON.stringify(parsed);
              steps.push(stepText);
              setStreamingMessage(prev => prev ? { 
                ...prev, 
                steps: [...(prev.steps || []), stepText] 
              } : null);
            } else if (parsed.type === "agent" && parsed.text) {
              // Agent status updates
              steps.push(parsed.text);
              setStreamingMessage(prev => prev ? { 
                ...prev, 
                steps: [...(prev.steps || []), parsed.text] 
              } : null);
            }
          } catch {
            // Not JSON, might be plain text content
            if (line.trim()) {
              fullContent += line;
              setStreamingMessage({ 
                role: "assistant", 
                content: fullContent, 
                isStreaming: true,
                steps 
              });
            }
          }
        }
      }

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

      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: fullContent,
      });
    } catch (error: any) {
      setStreamingMessage(null);
      toast.error(error.message || "Failed to send message");
    } finally {
      setLoading(false);
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

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    if (pendingMessage) {
      // Small delay to ensure auth state is updated, skip auth check since we just authenticated
      setTimeout(() => {
        handleSend(pendingMessage, true);
        setPendingMessage(null);
      }, 100);
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
      {messages.length === 0 && !conversationId ? (
        <div className="flex-1 flex flex-col items-center justify-center px-5 md:px-6 pt-14 md:pt-0 relative overflow-hidden bg-background">
          {/* Subtle gradient background */}
          <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.03)_0%,hsl(256_100%_68%/0.04)_50%,hsl(195_100%_65%/0.03)_100%)]" />
          <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/3 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-aqua/3 rounded-full blur-3xl" />
          <h1 className="relative z-10 text-2xl md:text-3xl lg:text-4xl font-bold mb-3 text-center animate-fade-in px-2">Echo — Bringing the Voice of Customers Back to You</h1>
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
                <button 
                  onClick={() => handleSend()}
                  disabled={!input.trim() || loading}
                  className="bg-foreground text-background rounded-full p-2.5 hover:opacity-80 transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
            {isListening && (
              <p className="text-center text-sm text-muted-foreground mt-4 animate-pulse">
                Speak now... Click the mic to stop.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col relative overflow-hidden bg-background">
          {/* Subtle gradient background - same as welcome screen */}
          <div className="absolute inset-0 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.03)_0%,hsl(256_100%_68%/0.04)_50%,hsl(195_100%_65%/0.03)_100%)]" />
          <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-primary/3 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-aqua/3 rounded-full blur-3xl" />
          
          <ScrollArea className="flex-1 px-4 md:px-6 py-5 pt-14 md:pt-8 relative z-10">
            <div className="space-y-6 max-w-3xl mx-auto pb-8">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "user" ? (
                    <div className="max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 bg-muted text-foreground shadow-sm">
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                  ) : (
                    <div className="w-full">
                      <MarkdownRenderer content={msg.content} />
                    </div>
                  )}
                </div>
              ))}
              {streamingMessage && (
                <div className="flex justify-start">
                  <div className="w-full space-y-3">
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
                <div className="flex justify-start py-2">
                  <div className="flex items-center gap-2 text-muted-foreground px-1">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-2 h-2 bg-primary rounded-full animate-bounce"></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <div className="p-4 md:p-6 pb-5 md:pb-7 bg-transparent relative z-10">
            <div className="max-w-3xl mx-auto relative px-1">
              {/* Gradient glow behind input */}
              <div className="absolute -inset-1.5 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.25)_0%,hsl(256_100%_68%/0.15)_50%,hsl(195_100%_65%/0.25)_100%)] rounded-[2rem] blur-xl opacity-50" />
              <div className={`relative flex items-center gap-3 bg-background/90 backdrop-blur-sm border rounded-3xl px-4 md:px-5 py-3.5 transition-all shadow-sm ${isListening ? 'border-red-500 bg-red-500/10' : 'border-border/80'}`}>
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
                  <button 
                    onClick={() => handleSend()}
                    disabled={!input.trim() || loading}
                    className="bg-foreground text-background rounded-full p-2.5 hover:opacity-80 transition-all disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
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
    </div>
  );
};

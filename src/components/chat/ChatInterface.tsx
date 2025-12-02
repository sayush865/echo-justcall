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
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef2 = useRef<HTMLTextAreaElement>(null);

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

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    triggerHaptic("medium");
    const userMessage = input.trim();
    setInput("");
    resetTranscript();
    setLoading(true);

    // Optimistically add user message to UI immediately
    const tempUserMsgId = `temp-user-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: tempUserMsgId,
      role: "user",
      content: userMessage,
      created_at: new Date().toISOString()
    }]);

    try {
      let currentConversationId = conversationId;

      if (!currentConversationId) {
        const { data: newConv, error: convError } = await supabase
          .from("conversations")
          .insert({ title: userMessage.slice(0, 50) })
          .select()
          .single();

        if (convError) throw convError;
        currentConversationId = newConv.id;
        onConversationCreated(currentConversationId);
      }

      const { error: msgError } = await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "user",
        content: userMessage,
      });

      if (msgError) throw msgError;

      const { data, error } = await supabase.functions.invoke("chat", {
        body: { message: userMessage, conversationId: currentConversationId },
      });

      if (error) throw error;

      const fullResponse = data.response;
      
      // Stream the response character by character
      setStreamingMessage({ role: "assistant", content: "", isStreaming: true });
      
      for (let i = 0; i <= fullResponse.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 8));
        setStreamingMessage({ 
          role: "assistant", 
          content: fullResponse.slice(0, i), 
          isStreaming: i < fullResponse.length 
        });
      }
      
      // Optimistically add to messages before clearing streaming
      const tempId = `temp-${Date.now()}`;
      setMessages(prev => [...prev, {
        id: tempId,
        role: "assistant",
        content: fullResponse,
        created_at: new Date().toISOString()
      }]);
      
      setStreamingMessage(null);

      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: fullResponse,
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

  return (
    <div className="flex-1 flex flex-col h-screen min-w-0">
      {messages.length === 0 && !conversationId ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 pt-12 md:pt-0">
          <h1 className="text-2xl md:text-3xl font-medium mb-8 text-center">What can I help with?</h1>
          <div className="w-full max-w-2xl px-2">
            <div className={`flex items-center gap-2 md:gap-3 bg-muted/50 border rounded-3xl px-3 md:px-4 py-3 transition-colors ${isListening ? 'border-red-500 bg-red-500/10' : 'border-border'}`}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => handleInputChange(e, textareaRef)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? "Listening..." : "Ask anything"}
                className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground resize-none min-h-[24px] max-h-[200px] py-0"
                rows={1}
                disabled={loading}
              />
              <div className="flex items-center gap-2">
                {isSupported && (
                  <button 
                    onClick={handleVoiceToggle}
                    className={`transition-colors ${isListening ? 'text-red-500 animate-pulse' : 'text-muted-foreground hover:text-foreground'}`}
                    title={isListening ? "Stop listening" : "Start voice input"}
                  >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                )}
                <button 
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                  className="bg-foreground text-background rounded-full p-2 hover:opacity-80 transition-opacity disabled:opacity-50"
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
              <p className="text-center text-sm text-muted-foreground mt-3 animate-pulse">
                Speak now... Click the mic to stop.
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <ScrollArea className="flex-1 p-2 md:p-4 pt-12 md:pt-4">
            <div className="space-y-4 max-w-3xl mx-auto pb-4 px-1 md:px-0">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {msg.role === "user" ? (
                    <div className="max-w-[90%] md:max-w-[80%] rounded-2xl px-4 py-2.5 bg-primary text-primary-foreground">
                      <p className="whitespace-pre-wrap">{msg.content}</p>
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
                  <div className="w-full">
                    <MarkdownRenderer content={streamingMessage.content + (streamingMessage.isStreaming ? "▋" : "")} />
                  </div>
                </div>
              )}
              {loading && !streamingMessage && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <div className="p-2 md:p-4 bg-background/80 backdrop-blur-sm">
            <div className="max-w-3xl mx-auto">
              <div className={`flex items-center gap-2 md:gap-3 bg-muted/50 border rounded-3xl px-3 md:px-4 py-3 transition-colors ${isListening ? 'border-red-500 bg-red-500/10' : 'border-border'}`}>
                <textarea
                  ref={textareaRef2}
                  value={input}
                  onChange={(e) => handleInputChange(e, textareaRef2)}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? "Listening..." : "Ask anything"}
                  className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground resize-none min-h-[24px] max-h-[200px] py-0"
                  rows={1}
                  disabled={loading}
                />
                <div className="flex items-center gap-2">
                  {isSupported && (
                    <button 
                      onClick={handleVoiceToggle}
                      className={`transition-colors ${isListening ? 'text-red-500 animate-pulse' : 'text-muted-foreground hover:text-foreground'}`}
                      title={isListening ? "Stop listening" : "Start voice input"}
                    >
                      {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                  )}
                  <button 
                    onClick={handleSend}
                    disabled={!input.trim() || loading}
                    className="bg-foreground text-background rounded-full p-2 hover:opacity-80 transition-opacity disabled:opacity-50"
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
                <p className="text-center text-sm text-muted-foreground mt-3 animate-pulse">
                  Speak now... Click the mic to stop.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Mic, MicOff, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { useVoiceInput } from "@/hooks/useVoiceInput";

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
  
  const { isListening, transcript, startListening, stopListening, resetTranscript, isSupported } = useVoiceInput();

  // Update input with transcript when voice input is active
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
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

    const userMessage = input.trim();
    setInput("");
    resetTranscript();
    setLoading(true);

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
    if (isListening) {
      stopListening();
    } else {
      resetTranscript();
      setInput("");
      startListening();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-screen">
      {messages.length === 0 && !conversationId ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <h1 className="text-3xl font-medium mb-8">What can I help with?</h1>
          <div className="w-full max-w-2xl">
            <div className={`flex items-center gap-3 bg-muted/50 border rounded-full px-4 py-3 transition-colors ${isListening ? 'border-red-500 bg-red-500/10' : 'border-border'}`}>
              <button className="text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="w-5 h-5" />
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? "Listening..." : "Ask anything"}
                className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
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
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4 max-w-3xl mx-auto pb-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-4 ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card border border-border"
                    }`}
                  >
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <MarkdownRenderer content={msg.content} />
                    )}
                  </div>
                </div>
              ))}
              {streamingMessage && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg p-4 bg-card border border-border">
                    <MarkdownRenderer content={streamingMessage.content + (streamingMessage.isStreaming ? " ▋" : "")} />
                  </div>
                </div>
              )}
              {loading && !streamingMessage && (
                <div className="flex justify-start">
                  <div className="bg-card border border-border rounded-lg p-4">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          </ScrollArea>

          <div className="p-4 bg-background/80 backdrop-blur-sm">
            <div className="max-w-3xl mx-auto">
              <div className={`flex items-center gap-3 bg-muted/50 border rounded-full px-4 py-3 transition-colors ${isListening ? 'border-red-500 bg-red-500/10' : 'border-border'}`}>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Plus className="w-5 h-5" />
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isListening ? "Listening..." : "Ask anything"}
                  className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
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

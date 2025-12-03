import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let fullResponse = "";

  try {
    const { message, conversationId } = await req.json();

    const WEBHOOK_URL = Deno.env.get("WEBHOOK_URL");
    if (!WEBHOOK_URL) {
      throw new Error("WEBHOOK_URL is not configured");
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch full conversation history
    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Error fetching messages:", messagesError);
    }

    // Fetch conversation details
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .single();

    if (conversationError) {
      console.error("Error fetching conversation:", conversationError);
    }

    const userId = conversation?.user_id;
    const userAgent = req.headers.get("user-agent") || "";
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";

    // Log user message
    await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      conversation_id: conversationId,
      event_type: "user_message",
      message_content: message,
      metadata: {
        message_count: messages?.length || 0,
        conversation_title: conversation?.title || "",
      },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Use GET with minimal params to avoid URL length limits (431 errors)
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("message", message);
    url.searchParams.set("conversationId", conversationId);
    url.searchParams.set("conversationTitle", conversation?.title || "");
    url.searchParams.set("messageCount", messages?.length?.toString() || "0");

    console.log("Calling webhook:", url.toString());

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log("Webhook response status:", response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Webhook error response:", errorText);
      
      // Log error
      await supabaseAdmin.from("audit_logs").insert({
        user_id: userId,
        conversation_id: conversationId,
        event_type: "webhook_error",
        metadata: {
          status: response.status,
          error: errorText,
          latency_ms: Date.now() - startTime,
        },
        ip_address: ipAddress,
        user_agent: userAgent,
      });
      
      throw new Error(`Webhook returned ${response.status}: ${errorText}`);
    }

    // Stream the response back to the client
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body from webhook");
    }

    // Create a TransformStream to pass through the chunks with proper flushing
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Process stream in background
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Log AI response when streaming is complete
            await supabaseAdmin.from("audit_logs").insert({
              user_id: userId,
              conversation_id: conversationId,
              event_type: "ai_response",
              ai_response: fullResponse,
              metadata: {
                latency_ms: Date.now() - startTime,
                response_length: fullResponse.length,
              },
              ip_address: ipAddress,
              user_agent: userAgent,
            });
            
            await writer.close();
            break;
          }
          
          // Pass through the chunk and accumulate response
          const chunk = decoder.decode(value, { stream: true });
          
          // Try to extract content from NDJSON chunks
          const lines = chunk.split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "item" && parsed.content) {
                fullResponse += parsed.content;
              }
            } catch {
              // Not JSON, might be plain text
              if (line.trim()) {
                fullResponse += line;
              }
            }
          }
          
          console.log("Streaming chunk:", chunk.substring(0, 100));
          // Write chunk immediately to ensure it's flushed
          await writer.write(encoder.encode(chunk));
        }
      } catch (error) {
        console.error("Stream error:", error);
        await writer.abort(error);
      }
    })();

    return new Response(readable, {
      headers: { 
        ...corsHeaders, 
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

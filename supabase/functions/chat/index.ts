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

  try {
    const { message, conversationId } = await req.json();

    const WEBHOOK_URL = Deno.env.get("WEBHOOK_URL");
    if (!WEBHOOK_URL) {
      throw new Error("WEBHOOK_URL is not configured");
    }

    // Initialize Supabase client to fetch conversation history
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Build URL with query parameters for GET request
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("message", message);
    url.searchParams.set("conversationId", conversationId);
    url.searchParams.set("conversationTitle", conversation?.title || "");
    url.searchParams.set("messageCount", messages?.length?.toString() || "0");
    url.searchParams.set("conversationHistory", JSON.stringify(messages || []));

    console.log("Calling webhook with full conversation:", url.toString());

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
      throw new Error(`Webhook returned ${response.status}: ${errorText}`);
    }

    // Stream the response back to the client
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body from webhook");
    }

    // Create a TransformStream to pass through the chunks
    const stream = new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder();
        
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              break;
            }
            
            // Pass through the chunk
            const chunk = decoder.decode(value, { stream: true });
            console.log("Streaming chunk:", chunk.substring(0, 100));
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch (error) {
          console.error("Stream error:", error);
          controller.error(error);
        }
      }
    });

    return new Response(stream, {
      headers: { 
        ...corsHeaders, 
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked"
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

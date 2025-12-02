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

    const responseText = await response.text();
    console.log("Raw webhook response:", responseText);

    let assistantResponse = "";
    
    // Check if response is NDJSON (streaming format from n8n AI Agent)
    if (responseText.includes('{"type":"') && responseText.includes('\n')) {
      console.log("Detected NDJSON streaming format");
      const lines = responseText.trim().split('\n');
      const contentParts: string[] = [];
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "item" && parsed.content) {
            contentParts.push(parsed.content);
          }
        } catch (e) {
          console.log("Skipping non-JSON line:", line.substring(0, 50));
        }
      }
      
      assistantResponse = contentParts.join('') || "No response";
      console.log("Extracted streaming response:", assistantResponse.substring(0, 200));
    } else {
      // Handle standard JSON response
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error("Failed to parse JSON:", parseError);
        throw new Error(`Webhook returned invalid JSON: ${responseText.substring(0, 200)}`);
      }

      console.log("Webhook response data:", JSON.stringify(data));

      // Handle array response from n8n (it returns an array with objects)
      const responseObj = Array.isArray(data) ? data[0] : data;
      assistantResponse = responseObj?.output || responseObj?.response || responseObj?.message || "No response";
      console.log("Extracted response:", assistantResponse);
    }

    return new Response(JSON.stringify({ response: assistantResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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

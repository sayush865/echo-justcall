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

    // Check content type to determine response format
    const contentType = response.headers.get("content-type") || "";
    const responseText = await response.text();
    
    console.log("Webhook response (first 200 chars):", responseText.substring(0, 200));

    // Try to parse as JSON with {answer, suggestions} format
    let answerContent = "";
    let suggestions: string[] = [];
    let isJsonFormat = false;

    try {
      const jsonResponse = JSON.parse(responseText);
      if (jsonResponse.answer) {
        isJsonFormat = true;
        answerContent = jsonResponse.answer;
        suggestions = jsonResponse.suggestions || [];
        fullResponse = answerContent;
        console.log("Detected JSON format with answer and suggestions");
      }
    } catch {
      // Not a single JSON object, might be NDJSON or plain text
      console.log("Response is not single JSON, treating as NDJSON/text stream");
    }

    // If it's JSON format, convert to NDJSON for the client
    if (isJsonFormat) {
      const ndjsonLines: string[] = [];
      
      // Send the answer as content item
      ndjsonLines.push(JSON.stringify({ type: "item", content: answerContent }));
      
      // Send suggestions if present
      if (suggestions.length > 0) {
        ndjsonLines.push(JSON.stringify({ type: "suggestions", suggestions }));
      }
      
      const ndjsonResponse = ndjsonLines.join('\n') + '\n';
      
      // Log AI response
      await supabaseAdmin.from("audit_logs").insert({
        user_id: userId,
        conversation_id: conversationId,
        event_type: "ai_response",
        ai_response: fullResponse,
        metadata: {
          latency_ms: Date.now() - startTime,
          response_length: fullResponse.length,
          suggestions_count: suggestions.length,
        },
        ip_address: ipAddress,
        user_agent: userAgent,
      });

      return new Response(ndjsonResponse, {
        headers: { 
          ...corsHeaders, 
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    // Otherwise, pass through as-is (NDJSON streaming from webhook)
    // Extract content for logging
    const lines = responseText.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "item" && parsed.content) {
          fullResponse += parsed.content;
        }
      } catch {
        if (line.trim()) {
          fullResponse += line;
        }
      }
    }

    // Log AI response
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

    return new Response(responseText, {
      headers: { 
        ...corsHeaders, 
        "Content-Type": "text/plain; charset=utf-8",
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

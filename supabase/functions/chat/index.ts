import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

// In-memory rate limiting (per edge function instance)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_MAX = 20; // requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

function checkServerRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    return { 
      allowed: false, 
      retryAfter: Math.ceil((entry.resetTime - now) / 1000) 
    };
  }
  
  entry.count++;
  return { allowed: true };
}

// Input validation
function validateMessage(message: unknown): { valid: boolean; error?: string; cleaned?: string } {
  if (typeof message !== 'string') {
    return { valid: false, error: 'Message must be a string' };
  }
  
  const trimmed = message.trim();
  
  if (trimmed.length === 0) {
    return { valid: false, error: 'Message cannot be empty' };
  }
  
  if (trimmed.length > 10000) {
    return { valid: false, error: 'Message exceeds maximum length (10,000 characters)' };
  }
  
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: 'Message contains invalid content' };
    }
  }
  
  return { valid: true, cleaned: trimmed };
}

function validateConversationId(id: unknown): { valid: boolean; error?: string } {
  if (id === null || id === undefined) {
    return { valid: true }; // Optional
  }
  
  if (typeof id !== 'string') {
    return { valid: false, error: 'Invalid conversation ID format' };
  }
  
  // UUID v4 pattern
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(id)) {
    return { valid: false, error: 'Invalid conversation ID' };
  }
  
  return { valid: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  let fullResponse = "";

  try {
    // Parse and validate request body
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { message, conversationId, backgroundMode } = body;

    // Validate message
    const messageValidation = validateMessage(message);
    if (!messageValidation.valid) {
      return new Response(
        JSON.stringify({ error: messageValidation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const cleanedMessage = messageValidation.cleaned!;

    // Validate conversationId
    const convIdValidation = validateConversationId(conversationId);
    if (!convIdValidation.valid) {
      return new Response(
        JSON.stringify({ error: convIdValidation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Fetch conversation details first to get user_id for rate limiting
    let userId: string | null = null;
    let conversation: Record<string, unknown> | null = null;
    
    if (conversationId) {
      const { data: conv, error: conversationError } = await supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .single();

      if (conversationError) {
        console.error("Error fetching conversation:", conversationError);
      } else {
        conversation = conv;
        userId = conv?.user_id as string | null;
      }
    }

    // Apply rate limiting if we have a user
    if (userId) {
      const rateCheck = checkServerRateLimit(userId);
      if (!rateCheck.allowed) {
        console.log("Rate limit exceeded for user:", userId);
        return new Response(
          JSON.stringify({ 
            error: "Rate limit exceeded. Please slow down.",
            retryAfter: rateCheck.retryAfter 
          }),
          { 
            status: 429, 
            headers: { 
              ...corsHeaders, 
              "Content-Type": "application/json",
              "Retry-After": String(rateCheck.retryAfter || 60)
            } 
          }
        );
      }
    }

    // Fetch full conversation history
    const { data: messages, error: messagesError } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Error fetching messages:", messagesError);
    }

    const userAgent = req.headers.get("user-agent") || "";
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";

    // Log user message
    await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      conversation_id: conversationId as string,
      event_type: "user_message",
      message_content: cleanedMessage,
      metadata: {
        message_count: messages?.length || 0,
        conversation_title: (conversation as Record<string, unknown>)?.title || "",
        background_mode: backgroundMode || false,
        message_length: cleanedMessage.length,
      },
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // If background mode, set pending_response and process in background
    if (backgroundMode) {
      console.log("Background mode enabled for conversation:", conversationId);
      
      // Set pending_response = true
      await supabaseAdmin
        .from("conversations")
        .update({ pending_response: true })
        .eq("id", conversationId);

      // Process in background using EdgeRuntime.waitUntil
      EdgeRuntime.waitUntil((async () => {
        try {
          const url = new URL(WEBHOOK_URL);
          url.searchParams.set("message", cleanedMessage);
          url.searchParams.set("conversationId", conversationId as string);
          url.searchParams.set("conversationTitle", String((conversation as Record<string, unknown>)?.title || ""));
          url.searchParams.set("messageCount", messages?.length?.toString() || "0");

          console.log("Background: Calling webhook");

          const response = await fetch(url.toString(), {
            method: "GET",
            headers: { "Content-Type": "application/json" },
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error("Background: Webhook error:", errorText);
            
            await supabaseAdmin.from("audit_logs").insert({
              user_id: userId,
              conversation_id: conversationId as string,
              event_type: "webhook_error",
              metadata: { status: response.status, error: errorText, background_mode: true },
            });
            
            await supabaseAdmin
              .from("conversations")
              .update({ pending_response: false })
              .eq("id", conversationId);
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body from webhook");
          }

          const decoder = new TextDecoder();
          let bgFullResponse = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === "item" && parsed.content) {
                  bgFullResponse += parsed.content;
                }
              } catch {
                if (line.trim()) {
                  bgFullResponse += line;
                }
              }
            }
          }

          console.log("Background: Response complete, length:", bgFullResponse.length);

          const { data: insertedMsg } = await supabaseAdmin.from("messages").insert({
            conversation_id: conversationId as string,
            role: "assistant",
            content: bgFullResponse,
            user_id: userId,
          }).select('id').single();

          await supabaseAdmin.from("audit_logs").insert({
            user_id: userId,
            conversation_id: conversationId as string,
            event_type: "ai_response",
            ai_response: bgFullResponse.substring(0, 5000), // Truncate for storage
            metadata: {
              latency_ms: Date.now() - startTime,
              response_length: bgFullResponse.length,
              background_mode: true,
            },
          });

          // Generate follow-up suggestions
          try {
            const followUpResponse = await fetch(`${supabaseUrl}/functions/v1/generate-followups`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                lastUserMessage: cleanedMessage,
                lastAIResponse: bgFullResponse.substring(0, 1500),
              }),
            });

            if (followUpResponse.ok) {
              const followUpData = await followUpResponse.json();
              if (followUpData?.suggestions?.length > 0 && insertedMsg?.id) {
                await supabaseAdmin.from("messages")
                  .update({ follow_up_suggestions: followUpData.suggestions })
                  .eq("id", insertedMsg.id);
              }
            }
          } catch (err) {
            console.error("Background: Failed to generate follow-ups:", err);
          }

          await supabaseAdmin
            .from("conversations")
            .update({ pending_response: false })
            .eq("id", conversationId);

          console.log("Background: Processing complete");
        } catch (error) {
          console.error("Background processing error:", error);
          await supabaseAdmin
            .from("conversations")
            .update({ pending_response: false })
            .eq("id", conversationId);
        }
      })());

      return new Response(
        JSON.stringify({ status: "processing", conversationId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Regular streaming mode
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("message", cleanedMessage);
    url.searchParams.set("conversationId", conversationId as string);
    url.searchParams.set("conversationTitle", String((conversation as Record<string, unknown>)?.title || ""));
    url.searchParams.set("messageCount", messages?.length?.toString() || "0");

    console.log("Calling webhook");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    console.log("Webhook response status:", response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Webhook error response:", errorText);
      
      await supabaseAdmin.from("audit_logs").insert({
        user_id: userId,
        conversation_id: conversationId as string,
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

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body from webhook");
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            await supabaseAdmin.from("audit_logs").insert({
              user_id: userId,
              conversation_id: conversationId as string,
              event_type: "ai_response",
              ai_response: fullResponse.substring(0, 5000),
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
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim());
          
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

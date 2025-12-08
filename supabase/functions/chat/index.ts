import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// Declare EdgeRuntime global for Supabase Edge Functions
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Helper function to properly extract content from NDJSON stream
function extractContentFromNDJSON(chunk: string): string {
  let content = "";
  
  // n8n sends NDJSON where each line is a complete JSON object
  // Format: {"type":"item","content":"text","metadata":{...}}
  // We need to find all JSON objects and extract just the content field
  
  // First try to find complete JSON objects with type:"item"
  const jsonObjectPattern = /\{"type"\s*:\s*"item"\s*,\s*"content"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*"metadata"/g;
  let match;
  
  while ((match = jsonObjectPattern.exec(chunk)) !== null) {
    // Unescape the content string
    let extracted = match[1];
    extracted = extracted.replace(/\\n/g, '\n');
    extracted = extracted.replace(/\\"/g, '"');
    extracted = extracted.replace(/\\\\/g, '\\');
    content += extracted;
  }
  
  // If no matches found, try line-by-line JSON parsing as fallback
  if (!content) {
    const lines = chunk.split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "item" && typeof parsed.content === "string") {
          content += parsed.content;
        }
      } catch {
        // Skip non-JSON lines entirely - don't add raw text
      }
    }
  }
  
  return content;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const { message, conversationId, backgroundMode, warmup } = await req.json();

    // Handle warmup ping - instant response to pre-warm the function
    if (warmup) {
      return new Response(JSON.stringify({ status: "warm" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const userAgent = req.headers.get("user-agent") || "";
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";

    // PHASE 1: Parallel DB operations - execute all startup queries simultaneously
    const parallelStartTime = Date.now();
    const [_updateResult, messagesResult, conversationResult] = await Promise.all([
      // Update pending_response and clear streaming_content
      supabaseAdmin
        .from("conversations")
        .update({ pending_response: true, streaming_content: '' })
        .eq("id", conversationId),
      // Fetch messages
      supabaseAdmin
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true }),
      // Fetch conversation details
      supabaseAdmin
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle(),
    ]);
    const parallelDuration = Date.now() - parallelStartTime;
    console.log(`[Latency] Parallel DB startup: ${parallelDuration}ms`);

    const messages = messagesResult.data;
    const conversation = conversationResult.data;

    if (messagesResult.error) {
      console.error("Error fetching messages:", messagesResult.error);
    }
    if (conversationResult.error) {
      console.error("Error fetching conversation:", conversationResult.error);
    }

    const userId = conversation?.user_id;
    const userEmail = conversation?.user_email;

    // Fire-and-forget: Log user message (non-critical path)
    EdgeRuntime.waitUntil((async () => {
      try {
        await supabaseAdmin.from("audit_logs").insert({
          user_id: userId,
          conversation_id: conversationId,
          event_type: "user_message",
          message_content: message,
          metadata: {
            message_count: messages?.length || 0,
            conversation_title: conversation?.title || "",
            startup_parallel_time_ms: parallelDuration,
          },
          ip_address: ipAddress,
          user_agent: userAgent,
        });
      } catch (err) {
        console.error("Audit log error:", err);
      }
    })());

    // Use GET with minimal params to avoid URL length limits (431 errors)
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("message", message);
    url.searchParams.set("conversationId", conversationId);
    url.searchParams.set("conversationTitle", conversation?.title || "");
    url.searchParams.set("messageCount", messages?.length?.toString() || "0");

    // Background processing function - saves response to DB when complete
    const processInBackground = async () => {
      let fullResponse = "";
      let lastSaveTime = Date.now();
      
      try {
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

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body from webhook");
        }

        const decoder = new TextDecoder();
        
        // Read the stream and accumulate response
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          fullResponse += extractContentFromNDJSON(chunk);
          
          // Save progress every 500ms for live updates
          if (Date.now() - lastSaveTime > 500) {
            await supabaseAdmin
              .from("conversations")
              .update({ streaming_content: fullResponse })
              .eq("id", conversationId);
            lastSaveTime = Date.now();
          }
        }

        // Save the AI response to messages table
        if (fullResponse.length > 0) {
          await supabaseAdmin.from("messages").insert({
            conversation_id: conversationId,
            role: "assistant",
            content: fullResponse,
            user_id: userId,
            user_email: userEmail,
          });
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
            background_mode: backgroundMode || false,
          },
          ip_address: ipAddress,
          user_agent: userAgent,
        });

      } catch (error) {
        console.error("Background processing error:", error);
      } finally {
        // Always clear streaming_content and set pending_response = false when done
        await supabaseAdmin
          .from("conversations")
          .update({ pending_response: false, streaming_content: '' })
          .eq("id", conversationId);
      }
    };

    // If backgroundMode is true, use waitUntil and return immediately
    if (backgroundMode) {
      EdgeRuntime.waitUntil(processInBackground());
      return new Response(
        JSON.stringify({ status: "processing", conversationId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Normal streaming mode - process and stream to client
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

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
      
      // Set pending_response = false on error
      await supabaseAdmin
        .from("conversations")
        .update({ pending_response: false, streaming_content: '' })
        .eq("id", conversationId);
      
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
    let fullResponse = "";
    let lastSaveTime = Date.now();

    // Process stream in background
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // IMMEDIATELY close the stream - client unlocks now
            const streamCloseTime = Date.now();
            await writer.close();
            
            // Fire-and-forget cleanup using EdgeRuntime.waitUntil
            const finalResponse = fullResponse;
            const cleanupStartTime = Date.now();
            EdgeRuntime.waitUntil((async () => {
              try {
                // Parallel cleanup - both operations at once
                await Promise.all([
                  supabaseAdmin.from("audit_logs").insert({
                    user_id: userId,
                    conversation_id: conversationId,
                    event_type: "ai_response",
                    ai_response: finalResponse,
                    metadata: {
                      total_latency_ms: streamCloseTime - startTime,
                      response_length: finalResponse.length,
                      stream_close_time_ms: streamCloseTime - startTime,
                      cleanup_start_delay_ms: cleanupStartTime - streamCloseTime,
                      cleanup_duration_ms: Date.now() - cleanupStartTime,
                      fire_and_forget: true,
                    },
                    ip_address: ipAddress,
                    user_agent: userAgent,
                  }),
                  supabaseAdmin
                    .from("conversations")
                    .update({ pending_response: false, streaming_content: '' })
                    .eq("id", conversationId)
                ]);
                
                const cleanupEndTime = Date.now();
                console.log(`[Latency] Stream closed: ${streamCloseTime - startTime}ms, Cleanup: ${cleanupEndTime - cleanupStartTime}ms`);
              } catch (cleanupError) {
                console.error("Background cleanup error:", cleanupError);
              }
            })());
            
            break;
          }
          
          // Pass through the chunk and accumulate response using proper parser
          const chunk = decoder.decode(value, { stream: true });
          fullResponse += extractContentFromNDJSON(chunk);
          
          // Save progress every 500ms for live continuation when user returns
          if (Date.now() - lastSaveTime > 500) {
            // Fire-and-forget save - don't block streaming
            (async () => {
              try {
                await supabaseAdmin
                  .from("conversations")
                  .update({ streaming_content: fullResponse })
                  .eq("id", conversationId);
              } catch (err) {
                console.error("Progress save error:", err);
              }
            })();
            lastSaveTime = Date.now();
          }
          
          // Write chunk immediately to ensure it's flushed
          await writer.write(encoder.encode(chunk));
        }
      } catch (error) {
        console.error("Stream error (client likely disconnected):", error);
        
        // Fire-and-forget: Continue reading webhook and save complete response
        const savedResponseSoFar = fullResponse;
        EdgeRuntime.waitUntil((async () => {
          try {
            let finalResponse = savedResponseSoFar;
            let bgLastSaveTime = Date.now();
            
            // Continue reading remaining webhook response if reader is still active
            try {
              console.log(`[Background] Continuing to read webhook response...`);
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                finalResponse += extractContentFromNDJSON(chunk);
                
                // Save progress every 500ms for live updates
                if (Date.now() - bgLastSaveTime > 500) {
                  await supabaseAdmin
                    .from("conversations")
                    .update({ streaming_content: finalResponse })
                    .eq("id", conversationId);
                  bgLastSaveTime = Date.now();
                }
              }
              console.log(`[Background] Finished reading webhook: ${finalResponse.length} chars`);
            } catch (readError) {
              console.log(`[Background] Webhook read ended:`, readError);
            }
            
            // Save whatever we have (partial or complete)
            if (finalResponse && finalResponse.length > 0) {
              await supabaseAdmin.from("messages").insert({
                conversation_id: conversationId,
                role: "assistant",
                content: finalResponse,
                user_id: userId,
                user_email: userEmail,
              });
              console.log(`[Background] Saved response: ${finalResponse.length} chars`);
            }
            
            // Log the disconnection with response details
            await supabaseAdmin.from("audit_logs").insert({
              user_id: userId,
              conversation_id: conversationId,
              event_type: "ai_response",
              ai_response: finalResponse || "",
              metadata: {
                client_disconnected: true,
                continued_in_background: true,
                initial_content_length: savedResponseSoFar?.length || 0,
                final_response_length: finalResponse?.length || 0,
                latency_ms: Date.now() - startTime,
              },
              ip_address: ipAddress,
              user_agent: userAgent,
            });
            
            // Reset pending flag and clear streaming content
            await supabaseAdmin
              .from("conversations")
              .update({ pending_response: false, streaming_content: '' })
              .eq("id", conversationId);
              
            console.log(`[Background] Cleanup complete after client disconnect`);
          } catch (cleanupError) {
            console.error("Background processing error:", cleanupError);
            // Still try to reset pending flag on error
            try {
              await supabaseAdmin
                .from("conversations")
                .update({ pending_response: false, streaming_content: '' })
                .eq("id", conversationId);
            } catch {}
          }
        })());
        
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

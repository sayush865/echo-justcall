import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    // Build URL with query parameters for GET request
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("message", message);
    url.searchParams.set("conversationId", conversationId);

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
      throw new Error(`Webhook returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    return new Response(JSON.stringify({ response: data.response || data.message || "No response" }), {
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

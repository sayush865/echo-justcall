import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lastUserMessage, lastAIResponse } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Truncate AI response for faster processing
    const truncatedResponse = lastAIResponse?.substring(0, 1200) || "";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant that generates follow-up questions for a customer intelligence conversation. Generate 2-3 natural, relevant follow-up questions based on the conversation context. Focus on:
- Drilling deeper into specifics mentioned
- Exploring related data, trends, or segments
- Actionable next steps or insights

Return short labels (2-4 words) and detailed prompts.`,
          },
          {
            role: "user",
            content: `User asked: "${lastUserMessage}"

Echo responded: "${truncatedResponse}"

Generate 2-3 follow-up questions the user might want to ask next.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_followups",
              description: "Return 2-3 follow-up question suggestions",
              parameters: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string", description: "Short label (2-4 words)" },
                        prompt: { type: "string", description: "Detailed follow-up prompt" },
                      },
                      required: ["label", "prompt"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["suggestions"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_followups" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.warn("Rate limit hit for follow-ups generation");
        return new Response(JSON.stringify({ suggestions: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        console.warn("Payment required for follow-ups generation");
        return new Response(JSON.stringify({ suggestions: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ suggestions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    // Extract suggestions from tool call response
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        console.log("Generated follow-ups:", parsed.suggestions?.length || 0);
        return new Response(JSON.stringify({ suggestions: parsed.suggestions || [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e);
      }
    }

    return new Response(JSON.stringify({ suggestions: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("generate-followups error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ suggestions: [], error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

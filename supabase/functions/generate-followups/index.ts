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
    const truncatedResponse = lastAIResponse?.substring(0, 1000) || "";

    console.log("Generating follow-ups for message:", lastUserMessage?.substring(0, 50));

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
            content: `Generate exactly 3 follow-up questions for a customer intelligence conversation. Return them using the generate_followups function.`,
          },
          {
            role: "user",
            content: `User asked: "${lastUserMessage}"

AI responded with insights about: "${truncatedResponse.substring(0, 500)}"

Generate 3 natural follow-up questions. Each should have:
- label: 2-4 word short label
- prompt: Full detailed question`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_followups",
              description: "Return exactly 3 follow-up question suggestions",
              parameters: {
                type: "object",
                properties: {
                  suggestions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string", description: "Short 2-4 word label" },
                        prompt: { type: "string", description: "Full detailed question" },
                      },
                      required: ["label", "prompt"],
                    },
                    minItems: 3,
                    maxItems: 3,
                  },
                },
                required: ["suggestions"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_followups" } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      // Return default suggestions on error
      return new Response(JSON.stringify({ 
        suggestions: getDefaultSuggestions(lastUserMessage) 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    console.log("AI response structure:", JSON.stringify({
      hasChoices: !!data.choices,
      hasToolCalls: !!data.choices?.[0]?.message?.tool_calls,
      toolCallsLength: data.choices?.[0]?.message?.tool_calls?.length,
    }));
    
    // Extract suggestions from tool call response
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        const suggestions = parsed.suggestions || [];
        console.log("Generated follow-ups:", suggestions.length);
        
        if (suggestions.length > 0) {
          return new Response(JSON.stringify({ suggestions }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.error("Failed to parse tool call arguments:", e, toolCall.function.arguments);
      }
    }

    // Fallback: return default suggestions
    console.log("Using default suggestions as fallback");
    return new Response(JSON.stringify({ 
      suggestions: getDefaultSuggestions(lastUserMessage) 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (error: unknown) {
    console.error("generate-followups error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ 
      suggestions: [
        { label: "More details", prompt: "Can you provide more details on this?" },
        { label: "Related trends", prompt: "What related trends do you see in the data?" },
        { label: "Action items", prompt: "What actionable next steps do you recommend?" },
      ],
      error: errorMessage 
    }), {
      status: 200, // Return 200 with fallback suggestions
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function getDefaultSuggestions(userMessage: string): Array<{label: string, prompt: string}> {
  // Context-aware default suggestions
  const lowerMsg = userMessage?.toLowerCase() || "";
  
  if (lowerMsg.includes("customer") || lowerMsg.includes("feedback")) {
    return [
      { label: "Top concerns", prompt: "What are the top 3 concerns customers mentioned?" },
      { label: "Sentiment trends", prompt: "How has customer sentiment changed over time?" },
      { label: "Action items", prompt: "What actions should we take based on this feedback?" },
    ];
  }
  
  if (lowerMsg.includes("feature") || lowerMsg.includes("request")) {
    return [
      { label: "Priority ranking", prompt: "Which feature requests should we prioritize?" },
      { label: "Customer impact", prompt: "Which customers would benefit most from these features?" },
      { label: "Competitor comparison", prompt: "How do competitors handle these feature requests?" },
    ];
  }
  
  if (lowerMsg.includes("churn") || lowerMsg.includes("retention")) {
    return [
      { label: "Risk factors", prompt: "What are the main churn risk factors?" },
      { label: "Prevention steps", prompt: "What steps can we take to prevent churn?" },
      { label: "Success patterns", prompt: "What patterns do we see in retained customers?" },
    ];
  }
  
  // Generic fallback
  return [
    { label: "Dig deeper", prompt: "Can you provide more specific details on this?" },
    { label: "Related insights", prompt: "What related insights can you share?" },
    { label: "Next steps", prompt: "What actionable next steps do you recommend?" },
  ];
}

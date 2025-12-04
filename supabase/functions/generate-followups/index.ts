import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const { lastUserMessage, lastAIResponse, userMessageOnly } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Truncate AI response for faster processing
    const truncatedResponse = lastAIResponse?.substring(0, 1000) || "";
    const isUserMessageOnly = userMessageOnly === true || !lastAIResponse;
    const mode = isUserMessageOnly ? "user-only" : "full-context";

    console.log("=== FOLLOW-UP GENERATION START ===");
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      mode,
      userMessage: lastUserMessage?.substring(0, 100),
      userMessageLength: lastUserMessage?.length || 0,
      aiResponseLength: lastAIResponse?.length || 0,
      truncatedResponseLength: truncatedResponse.length,
    }));

    // Different prompts for user-only vs full-context
    const userContent = isUserMessageOnly
      ? `User's question: "${lastUserMessage}"

Generate 3 follow-ups that anticipate what the user likely wants to discover next. Focus on:
1. A question that explores root causes or deeper "why"
2. A question about actionable insights or next steps
3. A question that reveals related patterns or connections

Each should have:
- label: 2-4 word scannable label
- prompt: Specific, actionable question`
      : `User's original question: "${lastUserMessage}"

Brief AI response context: "${truncatedResponse.substring(0, 400)}"

Generate 3 follow-ups that help the user DISCOVER what they really need. Focus on:
1. A question that digs into root causes or "why"
2. A question that connects to actionable next steps
3. A question that reveals related patterns they haven't considered

Each should have:
- label: 2-4 word scannable label
- prompt: Specific, actionable question that advances their understanding`;

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
            content: `You generate follow-up questions for a customer intelligence platform called Echo. 

Your goal: Help users DISCOVER insights they didn't know to ask about. Guide them toward their unstated goals through progressive exploration.

Rules:
- Focus on what the USER likely wants to achieve, not just what the AI response said
- Each question should reveal NEW angles or deeper insights
- Think: "What would help this user reach their real goal, even if they don't know what that is yet?"
- Be specific to the domain (customer feedback, churn, support, sales calls, etc.)

Return suggestions using the generate_followups function.`,
          },
          {
            role: "user",
            content: userContent,
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

    const aiCallDuration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("=== FOLLOW-UP GENERATION ERROR ===");
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        mode,
        status: response.status,
        error: errorText,
        duration: aiCallDuration,
      }));
      
      return new Response(JSON.stringify({ 
        suggestions: getDefaultSuggestions(lastUserMessage),
        source: "default",
        meta: { mode, duration: aiCallDuration, reason: "ai-error" }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const totalDuration = Date.now() - startTime;
    
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        const suggestions = parsed.suggestions || [];
        
        console.log("=== FOLLOW-UP GENERATION SUCCESS ===");
        console.log(JSON.stringify({
          timestamp: new Date().toISOString(),
          mode,
          suggestionsCount: suggestions.length,
          duration: totalDuration,
          suggestions: suggestions.map((s: any) => s.label),
        }));
        
        if (suggestions.length > 0) {
          return new Response(JSON.stringify({ 
            suggestions,
            source: mode,
            meta: { mode, duration: totalDuration }
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.error("=== FOLLOW-UP PARSE ERROR ===");
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          mode,
          error: String(e),
          rawArgs: toolCall.function.arguments?.substring(0, 200),
        }));
      }
    }

    console.log("=== FOLLOW-UP FALLBACK ===");
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      mode,
      reason: "no-valid-suggestions",
      duration: totalDuration,
    }));
    
    return new Response(JSON.stringify({ 
      suggestions: getDefaultSuggestions(lastUserMessage),
      source: "default",
      meta: { mode, duration: totalDuration, reason: "fallback" }
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
      source: "error-fallback",
      error: errorMessage 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function getDefaultSuggestions(userMessage: string): Array<{label: string, prompt: string}> {
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
  
  return [
    { label: "Dig deeper", prompt: "Can you provide more specific details on this?" },
    { label: "Related insights", prompt: "What related insights can you share?" },
    { label: "Next steps", prompt: "What actionable next steps do you recommend?" },
  ];
}

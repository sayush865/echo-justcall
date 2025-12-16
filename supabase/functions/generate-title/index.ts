import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Input validation schema
const titleRequestSchema = z.object({
  userMessage: z.string().max(5000, "Message too long").optional(),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const rawBody = await req.json();

    // Validate input using Zod schema
    const parseResult = titleRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return new Response(
        JSON.stringify({ title: "New conversation" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { userMessage } = parseResult.data;

    if (!userMessage) {
      return new Response(
        JSON.stringify({ title: "New conversation" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ title: userMessage.slice(0, 40) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You are a title generator. Generate a very short, concise title (3-6 words max) that summarizes the user's query intent. Do NOT include quotes. Do NOT repeat the user's exact words. Focus on the topic or action being asked about. Examples:
- "What were the main issues customers reported last month?" → Customer Issues Summary
- "Show me sales trends" → Sales Trends Analysis
- "How many support tickets this week?" → Weekly Support Tickets
- "Summarize customer feedback about pricing" → Pricing Feedback Overview`
          },
          {
            role: "user",
            content: `Generate a short title for this query: "${userMessage.slice(0, 200)}"`
          }
        ],
        max_tokens: 20,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      // Fallback to truncated message
      return new Response(
        JSON.stringify({ title: userMessage.slice(0, 40) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    let title = data.choices?.[0]?.message?.content?.trim() || userMessage.slice(0, 40);
    
    // Clean up title - remove quotes if present
    title = title.replace(/^["']|["']$/g, '').trim();
    
    // Ensure reasonable length
    if (title.length > 50) {
      title = title.slice(0, 47) + "...";
    }

    return new Response(
      JSON.stringify({ title }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Title generation error:", error);
    return new Response(
      JSON.stringify({ title: "New conversation" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

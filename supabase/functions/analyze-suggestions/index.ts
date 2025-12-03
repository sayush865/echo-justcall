import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Suggestion {
  label: string;
  prompt: string;
  category: string;
  icon: string;
  priority: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('Starting suggestion analysis...');

    // Get recent conversations and messages (last 48 hours)
    const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: recentMessages, error: messagesError } = await supabase
      .from('messages')
      .select(`
        id,
        content,
        role,
        user_id,
        conversation_id,
        created_at,
        conversations!inner(title, user_id)
      `)
      .gte('created_at', cutoffDate)
      .order('created_at', { ascending: false })
      .limit(500);

    if (messagesError) {
      console.error('Error fetching messages:', messagesError);
      throw messagesError;
    }

    console.log(`Found ${recentMessages?.length || 0} recent messages`);

    if (!recentMessages || recentMessages.length === 0) {
      // Insert default global suggestions if no data
      await insertDefaultSuggestions(supabase);
      return new Response(JSON.stringify({ success: true, message: 'Inserted default suggestions (no recent data)' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group messages by user for personalization
    const userMessages: Record<string, typeof recentMessages> = {};
    const allUserMessages: string[] = [];

    for (const msg of recentMessages) {
      if (msg.role === 'user') {
        allUserMessages.push(msg.content);
        const userId = msg.user_id;
        if (userId) {
          if (!userMessages[userId]) {
            userMessages[userId] = [];
          }
          userMessages[userId].push(msg);
        }
      }
    }

    // Mark old suggestions as inactive
    await supabase
      .from('dynamic_suggestions')
      .update({ is_active: false })
      .eq('is_active', true);

    // Generate global suggestions (4)
    const globalSuggestions = await generateSuggestions(
      lovableApiKey,
      allUserMessages.slice(0, 100),
      4,
      'global'
    );

    console.log('Generated global suggestions:', globalSuggestions.length);

    // Insert global suggestions
    for (const suggestion of globalSuggestions) {
      await supabase.from('dynamic_suggestions').insert({
        user_id: null,
        label: suggestion.label,
        prompt: suggestion.prompt,
        category: suggestion.category,
        icon: suggestion.icon,
        priority: suggestion.priority,
        is_active: true,
        expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Generate personalized suggestions for active users (2 per user)
    const activeUserIds = Object.keys(userMessages).filter(
      userId => userMessages[userId].length >= 2
    );

    console.log(`Found ${activeUserIds.length} active users for personalization`);

    for (const userId of activeUserIds.slice(0, 20)) { // Limit to 20 users
      const userMsgs = userMessages[userId].map(m => m.content);
      
      try {
        const personalSuggestions = await generateSuggestions(
          lovableApiKey,
          userMsgs.slice(0, 20),
          2,
          'personal'
        );

        for (const suggestion of personalSuggestions) {
          await supabase.from('dynamic_suggestions').insert({
            user_id: userId,
            label: suggestion.label,
            prompt: suggestion.prompt,
            category: suggestion.category,
            icon: suggestion.icon,
            priority: suggestion.priority,
            is_active: true,
            expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
          });
        }

        console.log(`Generated ${personalSuggestions.length} personal suggestions for user ${userId}`);
      } catch (e) {
        console.error(`Failed to generate suggestions for user ${userId}:`, e);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      globalSuggestions: globalSuggestions.length,
      usersProcessed: activeUserIds.length 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-suggestions:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function generateSuggestions(
  apiKey: string,
  messages: string[],
  count: number,
  type: 'global' | 'personal'
): Promise<Suggestion[]> {
  const systemPrompt = type === 'global'
    ? `You are an AI that analyzes customer conversation patterns to generate helpful suggestion prompts for a customer intelligence platform called Echo. Echo helps product, sales, success, and support teams understand their customers.

Analyze the following user messages and identify key themes, concerns, and patterns. Generate ${count} suggestion prompts that would help users explore important customer insights.

Categories to consider:
- "churn" - Signs of customer churn risk or dissatisfaction
- "feature" - Feature requests and product feedback
- "integration" - Integration issues or technical problems
- "trend" - Emerging trends or patterns
- "support" - Common support issues
- "sales" - Sales-related insights

For each suggestion, provide:
- A short, scannable label (3-5 words max)
- A detailed prompt that will yield valuable insights
- A category from the list above
- An icon name (Lightbulb, AlertTriangle, Puzzle, TrendingUp, HeadsetIcon, Users)
- A priority (1-10, higher = more important)`
    : `You are an AI that generates personalized suggestion prompts for a specific user based on their recent conversation history with Echo, a customer intelligence platform.

Analyze this user's recent messages and generate ${count} personalized follow-up suggestions that would help them continue their research or explore related topics.

For each suggestion, provide:
- A short, scannable label (3-5 words max)
- A detailed prompt that continues or expands on their research
- A category (churn, feature, integration, trend, support, sales)
- An icon name (Lightbulb, AlertTriangle, Puzzle, TrendingUp, HeadsetIcon, Users)
- A priority (1-10, higher = more important)`;

  const userPrompt = `Here are recent ${type === 'global' ? 'customer queries' : 'your recent queries'}:

${messages.slice(0, 30).map((m, i) => `${i + 1}. ${m}`).join('\n')}

Generate ${count} suggestion prompts as a JSON array.`;

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      tools: [{
        type: 'function',
        function: {
          name: 'save_suggestions',
          description: 'Save the generated suggestion prompts',
          parameters: {
            type: 'object',
            properties: {
              suggestions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: 'Short display label (3-5 words)' },
                    prompt: { type: 'string', description: 'Detailed prompt to send to chat' },
                    category: { type: 'string', enum: ['churn', 'feature', 'integration', 'trend', 'support', 'sales'] },
                    icon: { type: 'string', enum: ['Lightbulb', 'AlertTriangle', 'Puzzle', 'TrendingUp', 'HeadsetIcon', 'Users'] },
                    priority: { type: 'number', minimum: 1, maximum: 10 }
                  },
                  required: ['label', 'prompt', 'category', 'icon', 'priority']
                }
              }
            },
            required: ['suggestions']
          }
        }
      }],
      tool_choice: { type: 'function', function: { name: 'save_suggestions' } }
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('AI API error:', error);
    throw new Error(`AI API error: ${response.status}`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  
  if (!toolCall) {
    console.error('No tool call in response:', JSON.stringify(data));
    return getDefaultSuggestions(count);
  }

  try {
    const args = JSON.parse(toolCall.function.arguments);
    return args.suggestions || [];
  } catch (e) {
    console.error('Failed to parse tool call arguments:', e);
    return getDefaultSuggestions(count);
  }
}

function getDefaultSuggestions(count: number): Suggestion[] {
  const defaults: Suggestion[] = [
    {
      label: 'Top Feature Requests',
      prompt: 'What are the most requested features from customers this week? Include sentiment and which customer segments are asking for them.',
      category: 'feature',
      icon: 'Lightbulb',
      priority: 8
    },
    {
      label: 'Churn Risk Signals',
      prompt: 'Identify customers showing signs of churn risk based on recent interactions. What are the common themes in their complaints or concerns?',
      category: 'churn',
      icon: 'AlertTriangle',
      priority: 9
    },
    {
      label: 'Integration Issues',
      prompt: 'Summarize the most common integration and technical issues customers are facing. Which integrations are causing the most friction?',
      category: 'integration',
      icon: 'Puzzle',
      priority: 7
    },
    {
      label: 'Sales Call Insights',
      prompt: 'What patterns are emerging from recent sales calls? What objections are prospects raising and how are they being addressed?',
      category: 'sales',
      icon: 'TrendingUp',
      priority: 6
    }
  ];
  return defaults.slice(0, count);
}

async function insertDefaultSuggestions(supabase: any) {
  const defaults = getDefaultSuggestions(4);
  
  // Mark old as inactive
  await supabase
    .from('dynamic_suggestions')
    .update({ is_active: false })
    .eq('is_active', true);

  for (const suggestion of defaults) {
    await supabase.from('dynamic_suggestions').insert({
      user_id: null,
      label: suggestion.label,
      prompt: suggestion.prompt,
      category: suggestion.category,
      icon: suggestion.icon,
      priority: suggestion.priority,
      is_active: true,
      expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    });
  }
}

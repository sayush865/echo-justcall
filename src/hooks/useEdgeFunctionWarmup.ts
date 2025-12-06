import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 4: Edge Function Warmup
 * Silently pings edge functions on app load to eliminate cold start latency.
 * Functions are warmed up in the background without blocking the UI.
 */
export const useEdgeFunctionWarmup = () => {
  const hasWarmedUp = useRef(false);

  useEffect(() => {
    // Only warm up once per app session
    if (hasWarmedUp.current) return;
    hasWarmedUp.current = true;

    const warmupFunctions = async () => {
      const warmupStart = Date.now();
      
      try {
        // Parallel warmup of both edge functions
        await Promise.all([
          supabase.functions.invoke('chat', { body: { warmup: true } }),
          supabase.functions.invoke('generate-followups', { body: { warmup: true } }),
        ]);
        
        console.log(`[Warmup] Edge functions warmed in ${Date.now() - warmupStart}ms`);
      } catch (error) {
        // Silent failure - warmup is best-effort
        console.log("[Warmup] Edge function warmup skipped");
      }
    };

    // Delay warmup slightly to not compete with initial render
    const timer = setTimeout(warmupFunctions, 500);
    
    return () => clearTimeout(timer);
  }, []);
};

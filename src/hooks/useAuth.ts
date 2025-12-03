import { useState, useEffect, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const hasTrackedLogin = useRef<string | null>(null);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Track login on SIGNED_IN event (only once per session)
        if (event === 'SIGNED_IN' && session?.user && hasTrackedLogin.current !== session.user.id) {
          hasTrackedLogin.current = session.user.id;
          
          // Use setTimeout to avoid Supabase deadlock
          setTimeout(async () => {
            // First get current login_count
            const { data: profile } = await supabase
              .from('profiles')
              .select('login_count')
              .eq('user_id', session.user.id)
              .single();
            
            // Then update with incremented value
            await supabase
              .from('profiles')
              .update({
                login_count: (profile?.login_count || 0) + 1,
                last_sign_in: new Date().toISOString()
              })
              .eq('user_id', session.user.id);
          }, 0);
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    hasTrackedLogin.current = null;
    await supabase.auth.signOut();
  };

  return { user, session, loading, signOut };
};

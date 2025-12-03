import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AuthModal = ({ isOpen, onClose, onSuccess }: AuthModalProps) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("signin");

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setDisplayName("");
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      
      // Update last_sign_in and increment login_count in profiles
      const { data: profile } = await supabase
        .from("profiles")
        .select("login_count")
        .eq("user_id", data.user?.id)
        .single();
      
      await supabase
        .from("profiles")
        .update({ 
          last_sign_in: new Date().toISOString(),
          login_count: (profile?.login_count || 0) + 1
        })
        .eq("user_id", data.user?.id);
      
      // Log sign in event
      await supabase.from("audit_logs").insert({
        user_id: data.user?.id,
        user_email: email,
        event_type: "auth_signin",
        metadata: { method: "password" },
      });
      
      resetForm();
      onSuccess();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            display_name: displayName,
          },
        },
      });
      if (error) throw error;
      
      // Log sign up event
      await supabase.from("audit_logs").insert({
        user_id: data.user?.id,
        user_email: email,
        event_type: "auth_signup",
        metadata: { display_name: displayName },
      });
      
      toast.success("Welcome to Echo!");
      resetForm();
      onSuccess();
    } catch (error: any) {
      if (error.message.includes("User already registered")) {
        toast.error("This email is already registered. Please sign in.");
        setActiveTab("signin");
      } else {
        toast.error(error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md overflow-hidden p-0">
        <div className="relative">
          {/* Gradient header */}
          <div className="absolute inset-0 h-32 bg-[linear-gradient(135deg,hsl(227_93%_60%/0.15)_0%,hsl(256_100%_68%/0.1)_50%,hsl(195_100%_65%/0.15)_100%)]" />
          
          <div className="relative px-6 pt-8 pb-6">
            <DialogHeader className="text-center space-y-2">
              <DialogTitle>
                <span className="text-3xl font-bold bg-gradient-to-r from-primary via-violet to-aqua bg-clip-text text-transparent animate-fade-in">
                  Echo
                </span>
              </DialogTitle>
              <DialogDescription className="text-muted-foreground animate-fade-in [animation-delay:100ms] opacity-0 [animation-fill-mode:forwards]">
                Customer insights, instantly
              </DialogDescription>
            </DialogHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
              <TabsList className="grid w-full grid-cols-2 bg-muted/50">
                <TabsTrigger 
                  value="signin" 
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200"
                >
                  Sign In
                </TabsTrigger>
                <TabsTrigger 
                  value="signup"
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all duration-200"
                >
                  Sign Up
                </TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-4 animate-fade-in">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-3">
                    <Input
                      type="email"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-11 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="h-11 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-11 bg-gradient-to-r from-primary to-violet hover:opacity-90 transition-all duration-200" 
                    disabled={loading}
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                        Signing in...
                      </span>
                    ) : "Sign In"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-4 animate-fade-in">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-3">
                    <Input
                      type="text"
                      placeholder="Display Name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      required
                      className="h-11 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                    />
                    <Input
                      type="email"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="h-11 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                    />
                    <Input
                      type="password"
                      placeholder="Password (min 6 characters)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      className="h-11 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full h-11 bg-gradient-to-r from-primary to-violet hover:opacity-90 transition-all duration-200" 
                    disabled={loading}
                  >
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                        Creating account...
                      </span>
                    ) : "Create Account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

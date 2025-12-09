import { useState, useEffect } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

export const ConnectionStatusIndicator = () => {
  const [status, setStatus] = useState<ConnectionStatus>("connected");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Track online/offline status
    const handleOnline = () => {
      setStatus("reconnecting");
      // Brief reconnecting state before showing connected
      setTimeout(() => {
        setStatus("connected");
        // Hide after showing connected briefly
        setTimeout(() => setVisible(false), 2000);
      }, 1000);
    };

    const handleOffline = () => {
      setStatus("disconnected");
      setVisible(true);
    };

    // Initial check
    if (!navigator.onLine) {
      setStatus("disconnected");
      setVisible(true);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Also monitor Supabase realtime connection
    const channel = supabase.channel("connection-monitor");
    
    channel
      .on("system", { event: "*" }, (payload) => {
        if (payload.event === "disconnect") {
          setStatus("disconnected");
          setVisible(true);
        } else if (payload.event === "reconnect") {
          setStatus("reconnecting");
          setVisible(true);
        } else if (payload.event === "connected") {
          setStatus("connected");
          setTimeout(() => setVisible(false), 2000);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setStatus("connected");
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          setStatus("disconnected");
          setVisible(true);
        }
      });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      supabase.removeChannel(channel);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-2 px-4 py-2 rounded-full",
        "text-sm font-medium shadow-lg backdrop-blur-sm",
        "animate-in slide-in-from-bottom-4 fade-in duration-300",
        status === "connected" && "bg-green-500/90 text-white",
        status === "disconnected" && "bg-destructive/90 text-destructive-foreground",
        status === "reconnecting" && "bg-yellow-500/90 text-yellow-950"
      )}
    >
      {status === "connected" && (
        <>
          <Wifi className="h-4 w-4" />
          <span>Connected</span>
        </>
      )}
      {status === "disconnected" && (
        <>
          <WifiOff className="h-4 w-4" />
          <span>Connection lost</span>
        </>
      )}
      {status === "reconnecting" && (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Reconnecting...</span>
        </>
      )}
    </div>
  );
};

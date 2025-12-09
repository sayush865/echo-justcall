import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Chat from "./pages/Chat";
import AdminDashboard from "./pages/AdminDashboard";
import SharedConversation from "./pages/SharedConversation";
import NotFound from "./pages/NotFound";
import { useEdgeFunctionWarmup } from "./hooks/useEdgeFunctionWarmup";
import { ConnectionStatusIndicator } from "./components/chat/ConnectionStatusIndicator";

const queryClient = new QueryClient();

// Inner component to use hooks
const AppContent = () => {
  // Phase 4: Warm up edge functions on app load
  useEdgeFunctionWarmup();
  
  return (
    <BrowserRouter>
      <ConnectionStatusIndicator />
      <Routes>
        <Route path="/" element={<Chat />} />
        <Route path="/c/:conversationId" element={<Chat />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/shared/:token" element={<SharedConversation />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppContent />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

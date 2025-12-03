import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminRole } from "@/hooks/useAdminRole";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Users, MessageSquare, Activity, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  login_count: number | null;
  last_sign_in: string | null;
  created_at: string;
}

interface Conversation {
  id: string;
  title: string;
  user_id: string | null;
  created_at: string;
  updated_at: string;
  status: string;
}

interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  user_email: string | null;
  user_id: string | null;
  created_at: string;
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminRole();
  
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!adminLoading && !isAdmin && user) {
      toast.error("Access denied. Admin privileges required.");
      navigate("/");
    }
  }, [isAdmin, adminLoading, user, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin]);

  const fetchData = async () => {
    setRefreshing(true);
    try {
      const [profilesRes, conversationsRes, messagesRes] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("conversations").select("*").order("updated_at", { ascending: false }),
        supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(500),
      ]);

      if (profilesRes.data) setProfiles(profilesRes.data);
      if (conversationsRes.data) setConversations(conversationsRes.data);
      if (messagesRes.data) setMessages(messagesRes.data);
    } catch (error) {
      toast.error("Failed to fetch data");
    } finally {
      setRefreshing(false);
    }
  };

  const getUserConversations = (userId: string) => 
    conversations.filter(c => c.user_id === userId);

  const getConversationMessages = (conversationId: string) =>
    messages.filter(m => m.conversation_id === conversationId);

  const getUserMessageCount = (userId: string) => {
    const userConvIds = getUserConversations(userId).map(c => c.id);
    return messages.filter(m => userConvIds.includes(m.conversation_id)).length;
  };

  if (authLoading || adminLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-semibold bg-gradient-to-r from-primary to-violet bg-clip-text text-transparent">
              Admin Dashboard
            </h1>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{profiles.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Conversations</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{conversations.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Messages</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{messages.length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="users" className="space-y-4">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="conversations">All Conversations</TabsTrigger>
            <TabsTrigger value="messages">Recent Messages</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>User Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {profiles.map((profile) => (
                      <div
                        key={profile.id}
                        className={`p-4 rounded-lg border transition-colors cursor-pointer ${
                          selectedUserId === profile.user_id 
                            ? "border-primary bg-primary/5" 
                            : "border-border hover:bg-muted/50"
                        }`}
                        onClick={() => setSelectedUserId(
                          selectedUserId === profile.user_id ? null : profile.user_id
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{profile.display_name || "No name"}</p>
                            <p className="text-sm text-muted-foreground">{profile.email}</p>
                          </div>
                          <div className="text-right text-sm">
                            <p className="text-muted-foreground">
                              Logins: <span className="font-medium text-foreground">{profile.login_count || 0}</span>
                            </p>
                            <p className="text-muted-foreground">
                              Messages: <span className="font-medium text-foreground">{getUserMessageCount(profile.user_id)}</span>
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Last: {profile.last_sign_in 
                                ? new Date(profile.last_sign_in).toLocaleDateString() 
                                : "Never"}
                            </p>
                          </div>
                        </div>

                        {/* Expanded user details */}
                        {selectedUserId === profile.user_id && (
                          <div className="mt-4 pt-4 border-t border-border">
                            <p className="text-sm font-medium mb-2">
                              Conversations ({getUserConversations(profile.user_id).length})
                            </p>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                              {getUserConversations(profile.user_id).map((conv) => (
                                <div key={conv.id} className="p-2 bg-muted/50 rounded text-sm">
                                  <p className="font-medium truncate">{conv.title}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {getConversationMessages(conv.id).length} messages • {new Date(conv.updated_at).toLocaleDateString()}
                                  </p>
                                  <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                                    {getConversationMessages(conv.id).slice(0, 5).map((msg) => (
                                      <div key={msg.id} className="text-xs p-1 rounded bg-background">
                                        <span className={`font-medium ${msg.role === "user" ? "text-primary" : "text-violet"}`}>
                                          {msg.role}:
                                        </span>{" "}
                                        <span className="text-muted-foreground line-clamp-2">{msg.content}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                              {getUserConversations(profile.user_id).length === 0 && (
                                <p className="text-sm text-muted-foreground">No conversations</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {profiles.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">No users found</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="conversations">
            <Card>
              <CardHeader>
                <CardTitle>All Conversations</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {conversations.map((conv) => {
                      const userProfile = profiles.find(p => p.user_id === conv.user_id);
                      const msgCount = getConversationMessages(conv.id).length;
                      return (
                        <div key={conv.id} className="p-4 rounded-lg border border-border hover:bg-muted/50">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{conv.title}</p>
                              <p className="text-sm text-muted-foreground">
                                {userProfile?.email || "Unknown user"}
                              </p>
                            </div>
                            <div className="text-right text-sm">
                              <p className="font-medium">{msgCount} messages</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(conv.updated_at).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="messages">
            <Card>
              <CardHeader>
                <CardTitle>Recent Messages (Last 500)</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {messages.slice(0, 100).map((msg) => (
                      <div key={msg.id} className="p-3 rounded-lg border border-border">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                            msg.role === "user" 
                              ? "bg-primary/10 text-primary" 
                              : "bg-violet/10 text-violet"
                          }`}>
                            {msg.role}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {msg.user_email || "Unknown"} • {new Date(msg.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm line-clamp-3">{msg.content}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

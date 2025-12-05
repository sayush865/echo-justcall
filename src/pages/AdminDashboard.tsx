import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminRole } from "@/hooks/useAdminRole";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Users,
  MessageSquare,
  Activity,
  RefreshCw,
  Shield,
  ShieldOff,
  Trash2,
  LogIn,
  Lock,
  Mail,
  Search,
  UserCog,
  FileText,
  ArrowUpDown,
  X,
  Filter,
} from "lucide-react";
import { toast } from "sonner";

// Sort options
type UserSortOption = "newest" | "most_logins" | "most_messages" | "recent_login" | "alphabetical";
type MessageSortOption = "newest" | "oldest";
type ConversationSortOption = "recent" | "most_messages" | "oldest";
type AuditSortOption = "newest" | "oldest";

// Filter options
type RoleFilter = "all" | "user" | "assistant";
type EventTypeFilter = "all" | "user_message" | "ai_response" | "conversation_created" | "auth_signin" | "auth_signup" | "webhook_error";
type UserFilterOption = "all" | string; // "all" or a specific user_id

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

interface UserRole {
  id: string;
  user_id: string;
  role: "admin" | "moderator" | "user";
  created_at: string | null;
}

interface AuditLog {
  id: string;
  event_type: string;
  user_email: string | null;
  message_content: string | null;
  ai_response: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

// Admin Login Component
function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      toast.success("Logged in successfully");
      onSuccess();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Login failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet/5" />
      
      <Card className="w-full max-w-md relative z-10 border-border/50 bg-card/80 backdrop-blur-sm">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Admin Access</CardTitle>
          <CardDescription>Sign in with your admin credentials</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" />
              ) : (
                <LogIn className="h-4 w-4 mr-2" />
              )}
              Sign In
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Button variant="link" onClick={() => window.location.href = "/"} className="text-muted-foreground">
              ← Back to Echo
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Access Denied Component
function AccessDenied({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-destructive/5 via-transparent to-destructive/5" />
      
      <Card className="w-full max-w-md relative z-10 border-destructive/20 bg-card/80 backdrop-blur-sm">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
            <ShieldOff className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl font-bold">Access Denied</CardTitle>
          <CardDescription>You don't have admin privileges to access this page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Contact an administrator if you believe this is an error.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => window.location.href = "/"}>
              Go to Echo
            </Button>
            <Button variant="destructive" className="flex-1" onClick={onSignOut}>
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminRole();
  
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [addingAdmin, setAddingAdmin] = useState(false);

  // Actual counts from DB (not limited)
  const [totalCounts, setTotalCounts] = useState({
    users: 0,
    conversations: 0,
    messages: 0,
    admins: 0,
    activeUsers: 0,
    inactiveUsers: 0,
  });

  // Sort states
  const [userSort, setUserSort] = useState<UserSortOption>("most_logins");
  const [messageSort, setMessageSort] = useState<MessageSortOption>("newest");
  const [conversationSort, setConversationSort] = useState<ConversationSortOption>("recent");
  const [auditSort, setAuditSort] = useState<AuditSortOption>("newest");

  // Filter states
  const [messageRoleFilter, setMessageRoleFilter] = useState<RoleFilter>("all");
  const [auditEventFilter, setAuditEventFilter] = useState<EventTypeFilter>("all");
  const [userFilter, setUserFilter] = useState<UserFilterOption>("all");

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin]);

  const fetchData = async () => {
    setRefreshing(true);
    try {
      // Fetch counts separately for accurate stats
      const [
        profilesRes, 
        conversationsRes, 
        messagesRes, 
        rolesRes, 
        logsRes,
        usersCountRes,
        convsCountRes,
        msgsCountRes,
        adminsCountRes,
      ] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("conversations").select("*").order("updated_at", { ascending: false }).limit(500),
        supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(1000),
        supabase.from("user_roles").select("*"),
        supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(500),
        // Count queries for accurate totals
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("conversations").select("*", { count: "exact", head: true }),
        supabase.from("messages").select("*", { count: "exact", head: true }),
        supabase.from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin"),
        // Active users: login_count > 0 (returned at least once after signup)
        supabase.from("profiles").select("*", { count: "exact", head: true }).gt("login_count", 0),
        // Inactive users: login_count = 0 (never returned after signup)
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("login_count", 0),
      ]);

      if (profilesRes.data) setProfiles(profilesRes.data);
      if (conversationsRes.data) setConversations(conversationsRes.data);
      if (messagesRes.data) setMessages(messagesRes.data);
      if (rolesRes.data) setUserRoles(rolesRes.data as UserRole[]);
      if (logsRes.data) setAuditLogs(logsRes.data as AuditLog[]);
      
      // Get active/inactive counts from parallel queries
      const activeUsersCount = (await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).gt("login_count", 0)
      ]))[0].count || 0;
      
      const inactiveUsersCount = (await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("login_count", 0)
      ]))[0].count || 0;
      
      setTotalCounts({
        users: usersCountRes.count || 0,
        conversations: convsCountRes.count || 0,
        messages: msgsCountRes.count || 0,
        admins: adminsCountRes.count || 0,
        activeUsers: activeUsersCount,
        inactiveUsers: inactiveUsersCount,
      });
    } catch (error) {
      toast.error("Failed to fetch data");
    } finally {
      setRefreshing(false);
    }
  };

  // Realtime subscription for live updates
  useEffect(() => {
    if (!isAdmin) return;

    const channel = supabase
      .channel('admin-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        fetchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        fetchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const getUserConversations = (userId: string) => 
    conversations.filter(c => c.user_id === userId);

  const getConversationMessages = (conversationId: string) =>
    messages.filter(m => m.conversation_id === conversationId);

  const getUserMessageCount = (userId: string) => {
    const userConvIds = getUserConversations(userId).map(c => c.id);
    return messages.filter(m => userConvIds.includes(m.conversation_id)).length;
  };

  const getUserRole = (userId: string) => {
    return userRoles.find(r => r.user_id === userId)?.role || null;
  };

  const grantAdminRole = async (userId: string, email: string) => {
    try {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: "admin" });

      if (error) throw error;
      toast.success(`Admin role granted to ${email}`);
      fetchData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to grant admin role";
      toast.error(message);
    }
  };

  const revokeAdminRole = async (userId: string, email: string) => {
    try {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");

      if (error) throw error;
      toast.success(`Admin role revoked from ${email}`);
      fetchData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to revoke admin role";
      toast.error(message);
    }
  };

  const addAdminByEmail = async () => {
    if (!newAdminEmail.trim()) return;
    setAddingAdmin(true);

    try {
      // Find user by email in profiles
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("email", newAdminEmail.trim())
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profile) {
        toast.error("User not found with that email");
        return;
      }

      await grantAdminRole(profile.user_id, newAdminEmail.trim());
      setNewAdminEmail("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to add admin";
      toast.error(message);
    } finally {
      setAddingAdmin(false);
    }
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      // Delete messages first
      await supabase.from("messages").delete().eq("conversation_id", conversationId);
      // Then delete conversation
      const { error } = await supabase.from("conversations").delete().eq("id", conversationId);
      if (error) throw error;
      toast.success("Conversation deleted");
      fetchData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete conversation";
      toast.error(message);
    }
  };

  // Sorted and filtered users
  const sortedFilteredProfiles = useMemo(() => {
    let result = profiles.filter(p => 
      p.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    switch (userSort) {
      case "most_logins":
        return result.sort((a, b) => (b.login_count || 0) - (a.login_count || 0));
      case "most_messages":
        return result.sort((a, b) => getUserMessageCount(b.user_id) - getUserMessageCount(a.user_id));
      case "recent_login":
        return result.sort((a, b) => {
          const dateA = a.last_sign_in ? new Date(a.last_sign_in).getTime() : 0;
          const dateB = b.last_sign_in ? new Date(b.last_sign_in).getTime() : 0;
          return dateB - dateA;
        });
      case "alphabetical":
        return result.sort((a, b) => {
          const nameA = (a.display_name || a.email || "").toLowerCase();
          const nameB = (b.display_name || b.email || "").toLowerCase();
          return nameA.localeCompare(nameB);
        });
      case "newest":
      default:
        return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
  }, [profiles, searchQuery, userSort, messages, conversations]);

  // Sorted and filtered messages
  const sortedFilteredMessages = useMemo(() => {
    let result = [...messages];
    
    // Apply user filter
    if (userFilter !== "all") {
      const userConvIds = conversations.filter(c => c.user_id === userFilter).map(c => c.id);
      result = result.filter(m => userConvIds.includes(m.conversation_id));
    }
    
    // Apply search filter
    if (searchQuery) {
      result = result.filter(m => 
        m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.user_email?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Apply role filter
    if (messageRoleFilter !== "all") {
      result = result.filter(m => m.role === messageRoleFilter);
    }
    
    // Apply sort
    if (messageSort === "oldest") {
      return result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [messages, messageSort, messageRoleFilter, userFilter, conversations, searchQuery]);

  // Sorted and filtered conversations
  const sortedFilteredConversations = useMemo(() => {
    let result = conversations.filter(c =>
      c.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
    
    // Apply user filter
    if (userFilter !== "all") {
      result = result.filter(c => c.user_id === userFilter);
    }

    switch (conversationSort) {
      case "most_messages":
        return result.sort((a, b) => getConversationMessages(b.id).length - getConversationMessages(a.id).length);
      case "oldest":
        return result.sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
      case "recent":
      default:
        return result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
  }, [conversations, searchQuery, conversationSort, messages, userFilter]);

  // Sorted and filtered audit logs
  const sortedFilteredAuditLogs = useMemo(() => {
    let result = [...auditLogs];
    
    // Apply user filter
    if (userFilter !== "all") {
      const userProfile = profiles.find(p => p.user_id === userFilter);
      if (userProfile?.email) {
        result = result.filter(log => log.user_email === userProfile.email);
      }
    }
    
    // Apply search filter
    if (searchQuery) {
      result = result.filter(log => 
        log.user_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.message_content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        log.event_type.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Apply event type filter
    if (auditEventFilter !== "all") {
      result = result.filter(log => log.event_type === auditEventFilter);
    }
    
    // Apply sort
    if (auditSort === "oldest") {
      return result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [auditLogs, auditSort, auditEventFilter, userFilter, profiles, searchQuery]);

  const clearFilters = () => {
    setUserSort("most_logins");
    setMessageSort("newest");
    setConversationSort("recent");
    setAuditSort("newest");
    setMessageRoleFilter("all");
    setAuditEventFilter("all");
    setUserFilter("all");
    setSearchQuery("");
  };

  const hasActiveFilters = userSort !== "most_logins" || messageSort !== "newest" || 
    conversationSort !== "recent" || auditSort !== "newest" || 
    messageRoleFilter !== "all" || auditEventFilter !== "all" || 
    userFilter !== "all" || searchQuery !== "";
    
  const getSelectedUserName = () => {
    if (userFilter === "all") return "All Users";
    const profile = profiles.find(p => p.user_id === userFilter);
    return profile?.display_name || profile?.email || "Unknown";
  };

  // Loading state
  if (authLoading || adminLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Verifying access...</p>
        </div>
      </div>
    );
  }

  // Not logged in - show admin login
  if (!user) {
    return <AdminLogin onSuccess={() => window.location.reload()} />;
  }

  // Logged in but not admin
  if (!isAdmin) {
    return <AccessDenied onSignOut={signOut} />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold bg-gradient-to-r from-primary to-violet bg-clip-text text-transparent">
                Admin Dashboard
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user.email}
            </span>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCounts.users}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Conversations</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCounts.conversations}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Messages</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCounts.messages}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Admins</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCounts.admins}</div>
            </CardContent>
          </Card>
        </div>
        
        {/* Active/Inactive Users Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Card className="border-green-500/20 bg-green-500/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400">Active Users</CardTitle>
              <Users className="h-4 w-4 text-green-600 dark:text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">{totalCounts.activeUsers}</div>
              <p className="text-xs text-muted-foreground mt-1">Returned after signup</p>
            </CardContent>
          </Card>
          <Card className="border-orange-500/20 bg-orange-500/5">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-orange-600 dark:text-orange-400">Inactive Users</CardTitle>
              <Users className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{totalCounts.inactiveUsers}</div>
              <p className="text-xs text-muted-foreground mt-1">Never returned after signup</p>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users, conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
              {searchQuery && (
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-2">
                <X className="h-4 w-4" />
                Clear Filters
              </Button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="users" className="space-y-4">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="roles" className="gap-2">
              <UserCog className="h-4 w-4" />
              Role Management
            </TabsTrigger>
            <TabsTrigger value="conversations" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Conversations
            </TabsTrigger>
            <TabsTrigger value="messages" className="gap-2">
              <Activity className="h-4 w-4" />
              Messages
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-2">
              <FileText className="h-4 w-4" />
              Audit Logs
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>User Activity</CardTitle>
                    <CardDescription>View and manage all registered users</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                    <Select value={userSort} onValueChange={(v) => setUserSort(v as UserSortOption)}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="most_logins">Most Logins</SelectItem>
                        <SelectItem value="most_messages">Most Messages</SelectItem>
                        <SelectItem value="recent_login">Recent Login</SelectItem>
                        <SelectItem value="newest">Newest Users</SelectItem>
                        <SelectItem value="alphabetical">Alphabetical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-2">
                  Showing {sortedFilteredProfiles.length} of {profiles.length} users
                </div>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {sortedFilteredProfiles.map((profile) => {
                      const role = getUserRole(profile.user_id);
                      return (
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
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                                {(profile.display_name || profile.email || "?")[0].toUpperCase()}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">{profile.display_name || "No name"}</p>
                                  {role === "admin" && (
                                    <Badge variant="default" className="bg-primary/20 text-primary">
                                      <Shield className="h-3 w-3 mr-1" />
                                      Admin
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground">{profile.email}</p>
                              </div>
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
                                  </div>
                                ))}
                                {getUserConversations(profile.user_id).length === 0 && (
                                  <p className="text-sm text-muted-foreground">No conversations</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {sortedFilteredProfiles.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">No users found</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Role Management Tab */}
          <TabsContent value="roles" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Add Admin by Email</CardTitle>
                <CardDescription>Grant admin privileges to an existing user</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Input
                    placeholder="user@example.com"
                    value={newAdminEmail}
                    onChange={(e) => setNewAdminEmail(e.target.value)}
                    className="max-w-md"
                  />
                  <Button onClick={addAdminByEmail} disabled={addingAdmin || !newAdminEmail.trim()}>
                    {addingAdmin ? (
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Shield className="h-4 w-4 mr-2" />
                        Grant Admin
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Current Admins</CardTitle>
                <CardDescription>Manage admin roles for users</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2">
                    {profiles.map((profile) => {
                      const role = getUserRole(profile.user_id);
                      const isCurrentUser = profile.user_id === user.id;
                      
                      return (
                        <div
                          key={profile.id}
                          className="p-4 rounded-lg border border-border flex items-center justify-between"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                              {(profile.display_name || profile.email || "?")[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium">{profile.display_name || "No name"}</p>
                              <p className="text-sm text-muted-foreground">{profile.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {role === "admin" ? (
                              <>
                                <Badge variant="default" className="bg-primary/20 text-primary">
                                  <Shield className="h-3 w-3 mr-1" />
                                  Admin
                                </Badge>
                                {!isCurrentUser && (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                                        <ShieldOff className="h-4 w-4" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Revoke Admin Role</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Are you sure you want to revoke admin privileges from {profile.email}? They will lose access to the admin dashboard.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => revokeAdminRole(profile.user_id, profile.email || "")}
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                          Revoke
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                                {isCurrentUser && (
                                  <span className="text-xs text-muted-foreground">(You)</span>
                                )}
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => grantAdminRole(profile.user_id, profile.email || "")}
                              >
                                <Shield className="h-4 w-4 mr-2" />
                                Make Admin
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Conversations Tab */}
          <TabsContent value="conversations">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>All Conversations</CardTitle>
                    <CardDescription>Click on a conversation to view full chat history</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <Select value={userFilter} onValueChange={(v) => setUserFilter(v as UserFilterOption)}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Filter by user">{getSelectedUserName()}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Users</SelectItem>
                          {profiles.map((p) => (
                            <SelectItem key={p.user_id} value={p.user_id}>
                              {p.display_name || p.email || "Unknown"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                      <Select value={conversationSort} onValueChange={(v) => setConversationSort(v as ConversationSortOption)}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue placeholder="Sort by" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="recent">Most Recent</SelectItem>
                          <SelectItem value="most_messages">Most Messages</SelectItem>
                          <SelectItem value="oldest">Oldest First</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-2">
                  Showing {sortedFilteredConversations.length} of {conversations.length} conversations
                </div>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {sortedFilteredConversations.map((conv) => {
                      const userProfile = profiles.find(p => p.user_id === conv.user_id);
                      const msgCount = getConversationMessages(conv.id).length;
                      return (
                        <div 
                          key={conv.id} 
                          className="p-4 rounded-lg border border-border hover:bg-muted/50 flex items-center justify-between cursor-pointer transition-colors"
                          onClick={() => setSelectedConversation(conv)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{conv.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {userProfile?.email || "Unknown user"} • {msgCount} messages
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(conv.updated_at).toLocaleString()}
                            </p>
                          </div>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="text-destructive hover:text-destructive shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete this conversation? This will also delete all {msgCount} messages. This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteConversation(conv.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Conversation Detail Dialog */}
            <Dialog open={!!selectedConversation} onOpenChange={(open) => !open && setSelectedConversation(null)}>
              <DialogContent className="max-w-3xl max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle className="truncate pr-8">
                    {selectedConversation?.title}
                  </DialogTitle>
                  <p className="text-sm text-muted-foreground">
                    {profiles.find(p => p.user_id === selectedConversation?.user_id)?.email || "Unknown user"} • {new Date(selectedConversation?.created_at || "").toLocaleString()}
                  </p>
                </DialogHeader>
                <ScrollArea className="h-[60vh] pr-4">
                  <div className="space-y-4">
                    {selectedConversation && getConversationMessages(selectedConversation.id)
                      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                      .map((msg) => (
                        <div 
                          key={msg.id} 
                          className={`p-3 rounded-lg ${
                            msg.role === "user" 
                              ? "bg-primary/10 ml-8" 
                              : "bg-muted mr-8"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                              msg.role === "user" 
                                ? "bg-primary/20 text-primary" 
                                : "bg-violet/20 text-violet"
                            }`}>
                              {msg.role === "user" ? "User" : "Echo"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(msg.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      ))}
                    {selectedConversation && getConversationMessages(selectedConversation.id).length === 0 && (
                      <p className="text-center text-muted-foreground py-8">No messages in this conversation</p>
                    )}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>Recent Messages</CardTitle>
                    <CardDescription>View messages across all conversations</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <Select value={userFilter} onValueChange={(v) => setUserFilter(v as UserFilterOption)}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Filter by user">{getSelectedUserName()}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Users</SelectItem>
                          {profiles.map((p) => (
                            <SelectItem key={p.user_id} value={p.user_id}>
                              {p.display_name || p.email || "Unknown"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <Select value={messageRoleFilter} onValueChange={(v) => setMessageRoleFilter(v as RoleFilter)}>
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder="Role" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Roles</SelectItem>
                          <SelectItem value="user">User Only</SelectItem>
                          <SelectItem value="assistant">Echo Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                      <Select value={messageSort} onValueChange={(v) => setMessageSort(v as MessageSortOption)}>
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder="Sort" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="newest">Newest</SelectItem>
                          <SelectItem value="oldest">Oldest</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-2">
                  Showing {Math.min(sortedFilteredMessages.length, 100)} of {sortedFilteredMessages.length} messages
                </div>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {sortedFilteredMessages.slice(0, 100).map((msg) => {
                      // Get user email from message, or look up from conversation's user
                      const conversation = conversations.find(c => c.id === msg.conversation_id);
                      const userProfile = conversation ? profiles.find(p => p.user_id === conversation.user_id) : null;
                      const displayEmail = msg.user_email || userProfile?.email || "Unknown";
                      
                      return (
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
                              {displayEmail} • {new Date(msg.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm line-clamp-3">{msg.content}</p>
                        </div>
                      );
                    })}
                    {sortedFilteredMessages.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">No messages found</p>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Audit Logs Tab */}
          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>Audit Logs</CardTitle>
                    <CardDescription>View recent system activity and events</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      <Select value={userFilter} onValueChange={(v) => setUserFilter(v as UserFilterOption)}>
                        <SelectTrigger className="w-[180px]">
                          <SelectValue placeholder="Filter by user">{getSelectedUserName()}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Users</SelectItem>
                          {profiles.map((p) => (
                            <SelectItem key={p.user_id} value={p.user_id}>
                              {p.display_name || p.email || "Unknown"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <Select value={auditEventFilter} onValueChange={(v) => setAuditEventFilter(v as EventTypeFilter)}>
                        <SelectTrigger className="w-[160px]">
                          <SelectValue placeholder="Event Type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Events</SelectItem>
                          <SelectItem value="user_message">User Message</SelectItem>
                          <SelectItem value="ai_response">AI Response</SelectItem>
                          <SelectItem value="conversation_created">Conversation Created</SelectItem>
                          <SelectItem value="auth_signin">Sign In</SelectItem>
                          <SelectItem value="auth_signup">Sign Up</SelectItem>
                          <SelectItem value="webhook_error">Webhook Error</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                      <Select value={auditSort} onValueChange={(v) => setAuditSort(v as AuditSortOption)}>
                        <SelectTrigger className="w-[120px]">
                          <SelectValue placeholder="Sort" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="newest">Newest</SelectItem>
                          <SelectItem value="oldest">Oldest</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mb-2">
                  Showing {sortedFilteredAuditLogs.length} of {auditLogs.length} logs
                </div>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {sortedFilteredAuditLogs.map((log) => (
                      <div key={log.id} className="p-3 rounded-lg border border-border">
                        <div className="flex items-center justify-between mb-1">
                          <Badge variant="outline" className="text-xs">
                            {log.event_type}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{log.user_email || "System"}</p>
                        {log.message_content && (
                          <p className="text-sm line-clamp-2 mt-1">{log.message_content}</p>
                        )}
                      </div>
                    ))}
                    {sortedFilteredAuditLogs.length === 0 && (
                      <p className="text-center text-muted-foreground py-8">No audit logs found</p>
                    )}
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

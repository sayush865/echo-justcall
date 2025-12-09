// Shared types for chat functionality

export interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
  follow_up_suggestions?: { label: string; prompt: string }[];
}

export interface StreamingMessage {
  role: "assistant";
  content: string;
  isStreaming: boolean;
  steps?: string[];
}

export interface FollowUpSuggestion {
  label: string;
  prompt: string;
}

export interface SendMessageOptions {
  skipAuthCheck?: boolean;
  user?: { id: string; email?: string };
}

// Retry configuration
export const MAX_RETRIES = 3;
export const INITIAL_DELAY = 1000; // 1 second

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const getErrorMessage = (error: any, status?: number): { title: string; description?: string } => {
  if (status === 401) return { title: "Authentication required", description: "Please sign in again." };
  if (status === 403) return { title: "Permission denied", description: "You don't have permission to perform this action." };
  if (status === 429) return { title: "Too many requests", description: "Please wait a moment and try again." };
  if (status === 500) return { title: "Server error", description: "Our team has been notified." };
  if (status === 503) return { title: "Looks like Ayush is sleepy 😴", description: "The AI service is taking a nap. Give it a moment!" };
  if (error?.message?.includes("503") || error?.message?.includes("Service Unavailable")) {
    return { title: "Looks like Ayush is sleepy 😴", description: "The AI service is taking a nap. Give it a moment!" };
  }
  if (error?.message?.includes("RLS")) return { title: "Permission denied", description: "Please sign in again." };
  if (error?.message?.includes("network")) return { title: "Network error", description: "Check your connection and try again." };
  return { title: error?.message || "Something went wrong", description: "Please try again." };
};

// Helper to get user initials
export const getUserInitials = (displayName?: string | null): string => {
  if (!displayName) return "U";
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
};

// Helper to format message timestamp
export const formatMessageTime = (dateString: string): string => {
  const date = new Date(dateString);
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  const day = date.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  return `${day} ${month}, ${displayHours}:${minutes} ${ampm}`;
};

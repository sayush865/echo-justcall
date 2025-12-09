import React, { useMemo } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Copy, Check } from "lucide-react";
import { MemoizedMarkdownRenderer } from "./MarkdownRenderer";
import { EchoLogo } from "./EchoLogo";
import { parseCitations } from "@/lib/citationParser";
import { formatMessageTime, getUserInitials } from "@/types/chat";

interface Message {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

interface MessageItemProps {
  message: Message;
  userDisplayName?: string;
  copiedId: string | null;
  onCopy: (content: string, id: string) => void;
}

// Memoized source count calculation
const useSourceCount = (content: string, role: string) => {
  return useMemo(() => {
    if (role !== "assistant") return 0;
    return parseCitations(content).inlineCitations.size;
  }, [content, role]);
};

const MessageItemComponent = ({
  message,
  userDisplayName,
  copiedId,
  onCopy,
}: MessageItemProps) => {
  const sourceCount = useSourceCount(message.content, message.role);
  const isCopied = copiedId === message.id;

  if (message.role === "user") {
    return (
      <div className="flex gap-3 justify-end">
        <div className="group max-w-[90%] md:max-w-[75%]">
          <div className="rounded-2xl px-4 py-3 bg-muted text-foreground shadow-sm">
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          </div>
          <div className="flex justify-end items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">
              {formatMessageTime(message.created_at)}
            </span>
            <button
              onClick={() => onCopy(message.content, message.id)}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Copy message"
            >
              {isCopied ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
        <Avatar className="w-8 h-8 flex-shrink-0">
          <AvatarFallback className="bg-muted text-xs font-medium">
            {getUserInitials(userDisplayName)}
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  return (
    <div className="flex gap-3 justify-start">
      <EchoLogo size="md" className="mt-0.5" />
      <div className="flex-1 group min-w-0">
        <MemoizedMarkdownRenderer content={message.content} />
        <div className="flex justify-start items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">
            {formatMessageTime(message.created_at)}
          </span>
          {sourceCount > 0 && (
            <span className="text-xs text-muted-foreground">
              • {sourceCount} source{sourceCount !== 1 ? "s" : ""} found
            </span>
          )}
          <button
            onClick={() => onCopy(message.content, message.id)}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy response"
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Memoize the component - only re-render when props actually change
export const MessageItem = React.memo(MessageItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.copiedId === nextProps.copiedId &&
    prevProps.userDisplayName === nextProps.userDisplayName
  );
});

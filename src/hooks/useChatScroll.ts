import { useState, useRef, useEffect, useCallback } from "react";
import type { Message, StreamingMessage } from "@/types/chat";

interface UseChatScrollOptions {
  messages: Message[];
  streamingMessage: StreamingMessage | null;
}

export const useChatScroll = ({ messages, streamingMessage }: UseChatScrollOptions) => {
  const [isUserNearBottom, setIsUserNearBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setIsUserNearBottom(distanceFromBottom < 100);
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsUserNearBottom(true);
  }, []);

  const resumeAutoScroll = useCallback(() => {
    setIsUserNearBottom(true);
  }, []);

  // Only auto-scroll if user is near the bottom
  useEffect(() => {
    if (isUserNearBottom) {
      scrollRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, streamingMessage, isUserNearBottom]);

  return {
    isUserNearBottom,
    scrollRef,
    scrollContainerRef,
    handleScroll,
    scrollToBottom,
    resumeAutoScroll,
  };
};

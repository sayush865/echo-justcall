import { useState, useEffect, useRef } from "react";

// Echo-branded loading phrases that rotate during AI processing
const ECHO_LOADING_PHRASES = [
  "Gathering conversations...",
  "Searching customer insights...",
  "Analyzing call data...",
  "Connecting the dots...",
  "Listening to echoes...",
  "Processing feedback...",
  "Finding patterns...",
];

interface EchoLoadingIndicatorProps {
  asText?: boolean;
}

export const EchoLoadingIndicator = ({ asText = false }: EchoLoadingIndicatorProps) => {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const charIndexRef = useRef(0);

  // Typing animation effect for asText mode
  useEffect(() => {
    if (!asText) return;

    const currentPhrase = ECHO_LOADING_PHRASES[phraseIndex];
    
    if (isTyping) {
      // Typing phase
      if (charIndexRef.current < currentPhrase.length) {
        const timeout = setTimeout(() => {
          charIndexRef.current += 1;
          setDisplayedText(currentPhrase.slice(0, charIndexRef.current));
        }, 35); // Typing speed
        return () => clearTimeout(timeout);
      } else {
        // Finished typing, wait then start erasing
        const timeout = setTimeout(() => {
          setIsTyping(false);
        }, 1500); // Pause before erasing
        return () => clearTimeout(timeout);
      }
    } else {
      // Erasing phase
      if (charIndexRef.current > 0) {
        const timeout = setTimeout(() => {
          charIndexRef.current -= 1;
          setDisplayedText(currentPhrase.slice(0, charIndexRef.current));
        }, 20); // Erasing speed (faster than typing)
        return () => clearTimeout(timeout);
      } else {
        // Finished erasing, move to next phrase
        setPhraseIndex((prev) => (prev + 1) % ECHO_LOADING_PHRASES.length);
        setIsTyping(true);
      }
    }
  }, [asText, phraseIndex, displayedText, isTyping]);

  // Simple rotation for non-asText mode
  useEffect(() => {
    if (asText) return;
    
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % ECHO_LOADING_PHRASES.length);
    }, 2500);

    return () => clearInterval(interval);
  }, [asText]);

  if (asText) {
    return (
      <span className="text-sm text-muted-foreground animate-fade-in">
        {displayedText}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-gradient-to-r from-primary/10 to-primary/5 text-primary border border-primary/20 animate-fade-in shadow-sm">
      <span className="flex items-center gap-0.5">
        <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></span>
        <span className="w-1 h-1 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></span>
        <span className="w-1 h-1 bg-primary rounded-full animate-bounce"></span>
      </span>
      <span className="transition-all duration-300">{ECHO_LOADING_PHRASES[phraseIndex]}</span>
    </span>
  );
};

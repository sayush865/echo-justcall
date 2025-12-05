import { useState, useEffect } from "react";

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

export const EchoLoadingIndicator = () => {
  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % ECHO_LOADING_PHRASES.length);
    }, 2500); // Rotate every 2.5 seconds

    return () => clearInterval(interval);
  }, []);

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

import { useState, useEffect } from "react";

interface AnimatedPlaceholderProps {
  text: string;
  isVisible: boolean;
}

export const AnimatedPlaceholder = ({ text, isVisible }: AnimatedPlaceholderProps) => {
  const [displayText, setDisplayText] = useState("");
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    if (!isVisible) {
      setDisplayText("");
      return;
    }

    let timeout: NodeJS.Timeout;
    
    const animate = () => {
      if (isTyping) {
        // Typing forward
        if (displayText.length < text.length) {
          timeout = setTimeout(() => {
            setDisplayText(text.slice(0, displayText.length + 1));
          }, 80);
        } else {
          // Pause at full text, then start deleting
          timeout = setTimeout(() => {
            setIsTyping(false);
          }, 2000);
        }
      } else {
        // Deleting backward
        if (displayText.length > 0) {
          timeout = setTimeout(() => {
            setDisplayText(text.slice(0, displayText.length - 1));
          }, 40);
        } else {
          // Pause at empty, then start typing
          timeout = setTimeout(() => {
            setIsTyping(true);
          }, 500);
        }
      }
    };

    animate();

    return () => clearTimeout(timeout);
  }, [displayText, isTyping, text, isVisible]);

  if (!isVisible) return null;

  return (
    <span className="text-muted-foreground pointer-events-none">
      {displayText}
      <span className="animate-pulse">|</span>
    </span>
  );
};

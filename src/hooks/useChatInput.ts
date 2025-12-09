import { useState, useRef, useEffect, useCallback } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";

export const useChatInput = () => {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef2 = useRef<HTMLTextAreaElement>(null);
  
  const { isListening, transcript, startListening, stopListening, resetTranscript, isSupported } = useVoiceInput();

  // Update input with transcript when voice input is active
  useEffect(() => {
    if (transcript) {
      setInput(transcript);
      // Auto-resize textareas for voice input
      [textareaRef, textareaRef2].forEach(ref => {
        if (ref.current) {
          ref.current.style.height = 'auto';
          ref.current.style.height = `${Math.min(ref.current.scrollHeight, 200)}px`;
        }
      });
    }
  }, [transcript]);

  // Auto-resize textarea when input changes (including from suggestions)
  useEffect(() => {
    [textareaRef, textareaRef2].forEach(ref => {
      if (ref.current) {
        ref.current.style.height = 'auto';
        if (input) {
          ref.current.style.height = `${Math.min(ref.current.scrollHeight, 200)}px`;
        }
      }
    });
  }, [input]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>, ref: React.RefObject<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${Math.min(ref.current.scrollHeight, 200)}px`;
    }
  }, []);

  const clearInput = useCallback(() => {
    setInput("");
    resetTranscript();
  }, [resetTranscript]);

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      resetTranscript();
      setInput("");
      startListening();
    }
  }, [isListening, stopListening, startListening, resetTranscript]);

  const focusInput = useCallback((textareaNum: 1 | 2 = 1) => {
    const ref = textareaNum === 1 ? textareaRef : textareaRef2;
    setTimeout(() => ref.current?.focus(), 0);
  }, []);

  return {
    input,
    setInput,
    textareaRef,
    textareaRef2,
    isListening,
    isSupported,
    handleInputChange,
    clearInput,
    handleVoiceToggle,
    focusInput,
    resetTranscript,
  };
};

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface CodeBlockProps {
  language?: string;
  children: string;
}

export const CodeBlock = ({ language, children }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 p-2 rounded-md bg-muted/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-muted"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <Copy className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: "0.5rem",
          fontSize: "0.875rem",
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
};

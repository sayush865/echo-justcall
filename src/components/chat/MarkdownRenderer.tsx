import React, { useMemo, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { CitationBadges } from "./CitationBadges";
import { InlineCitationPill } from "./InlineCitationPill";
import { parseCitations, parseStreamingCitations, mergeWithPreloadedSources } from "@/lib/citationParser";
import type { PreloadedSource } from "@/lib/citationParser";
import type { Components } from "react-markdown";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  onSourceCount?: (count: number) => void;
  preloadedSources?: Map<number, PreloadedSource>; // Sources extracted from tool results during streaming
}

export const MarkdownRenderer = ({ content, isStreaming = false, onSourceCount, preloadedSources }: MarkdownRendererProps) => {
  // Use streaming-aware citation parsing with preloaded sources
  const { cleanContent, citations, inlineCitations } = useMemo(() => {
    const parsed = parseCitations(content);
    
    // Always try streaming citations as fallback if main parser found no inline citations
    // This ensures pills appear even with imperfect formatting
    if (parsed.inlineCitations.size === 0) {
      const streamingCitations = parseStreamingCitations(content);
      if (streamingCitations.size > 0) {
        // Remove source markers from display
        let cleanedContent = parsed.cleanContent
          .replace(/\[(?:source:)?(\d+)\]/gi, "%%CITATION_$1%%");
        
        // Merge with preloaded sources if available
        const mergedCitations = preloadedSources 
          ? mergeWithPreloadedSources(streamingCitations, preloadedSources)
          : streamingCitations;
        
        return {
          cleanContent: cleanedContent,
          citations: parsed.citations,
          inlineCitations: mergedCitations,
        };
      }
    }
    
    // For streaming content, merge streaming placeholders with any parsed citations
    if (isStreaming) {
      const streamingCitations = parseStreamingCitations(content);
      streamingCitations.forEach((streamingCitation, num) => {
        if (!parsed.inlineCitations.has(num)) {
          parsed.inlineCitations.set(num, streamingCitation);
        }
      });
      
      // Merge with preloaded sources
      if (preloadedSources) {
        const merged = mergeWithPreloadedSources(parsed.inlineCitations, preloadedSources);
        return {
          ...parsed,
          inlineCitations: merged,
        };
      }
    }
    
    return parsed;
  }, [content, isStreaming, preloadedSources]);

  // Report source count to parent
  useEffect(() => {
    if (onSourceCount) {
      onSourceCount(inlineCitations.size);
    }
  }, [inlineCitations.size, onSourceCount]);

  // Replace various citation formats with placeholders
  const contentWithPlaceholders = useMemo(() => {
    if (inlineCitations.size === 0) return cleanContent;
    
    let processed = cleanContent;
    
    // Helper to replace citation numbers with placeholders
    const replaceCitations = (nums: string): string => {
      const numbers = nums.split(/[,\s]+/).map((n: string) => parseInt(n.trim(), 10)).filter((n: number) => !isNaN(n));
      const hasAnyCitation = numbers.some((n: number) => inlineCitations.has(n));
      if (!hasAnyCitation) return "";
      return numbers.map((n: number) => `%%CITATION_${n}%%`).join(" ");
    };
    
    // Handle inline full source references like [source: CA123... (Sales Meeting)]
    // Replace with placeholder using the source number from inlineCitations
    processed = processed.replace(/\[source:?\s*([a-f0-9][a-f0-9-]*[a-f0-9])\s*\([^)]+\)\]/gi, (match, callId) => {
      // Find the citation with this callId
      for (const [num, citation] of inlineCitations) {
        if (citation.id === callId) {
          return `%%CITATION_${num}%%`;
        }
      }
      return ""; // Remove if not found (shouldn't happen)
    });
    
    // Handle quoted "Source X" patterns (with various quote types)
    processed = processed.replace(/["'""](?:sources?[:\s]?)?([\d,\s]+)["'""]/gi, (match, nums) => {
      const result = replaceCitations(nums);
      return result || match;
    });
    
    // Handle parenthesized citations: (source 1, source 2), (source 1), (1, 2, 3)
    processed = processed.replace(/\((?:sources?:?\s*)?([\d,\s]+)\)/gi, (match, nums) => {
      const result = replaceCitations(nums);
      return result || match;
    });
    
    // Handle bracketed citations: [source:1], [1], [source:1,2,3], [1,2,3], [Source 1]
    processed = processed.replace(/\[(?:source[:\s]?)?([\d,\s]+)\]/gi, (match, nums) => {
      const result = replaceCitations(nums);
      return result || match;
    });
    
    // Handle unbracketed "source X Y Z", "source X, Y, Z", "sources: X Y Z" patterns
    // Also catches trailing orphan patterns like "source 1 )" or "source 1""
    processed = processed.replace(/\bsources?:?\s*([\d,\s]+)\s*[)\]"'""']?/gi, (match, nums) => {
      const result = replaceCitations(nums);
      return result || match;
    });
    
    // Clean up any leftover orphan quotes/parens after citations
    processed = processed.replace(/%%CITATION_(\d+)%%\s*[)\]"'""']/g, "%%CITATION_$1%%");
    
    return processed;
  }, [cleanContent, inlineCitations]);

  // Render text with inline citations
  const renderTextWithCitations = (text: string): React.ReactNode => {
    if (inlineCitations.size === 0 || !text.includes("%%CITATION_")) {
      return text;
    }

    const parts = text.split(/(%%CITATION_\d+%%)/g);
    return parts.map((part, index) => {
      const match = part.match(/%%CITATION_(\d+)%%/);
      if (match) {
        const sourceNum = parseInt(match[1], 10);
        const citation = inlineCitations.get(sourceNum);
        if (citation) {
          return <InlineCitationPill key={index} citation={citation} />;
        }
      }
      return part;
    });
  };

  const components: Components = {
    code({ node, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const isInline = !match && !className;

      if (isInline) {
        return (
          <code className="bg-muted px-1.5 py-0.5 rounded text-sm" {...props}>
            {children}
          </code>
        );
      }

      return (
        <CodeBlock language={match?.[1]}>
          {String(children).replace(/\n$/, "")}
        </CodeBlock>
      );
    },
    // Override text rendering to inject citation pills
    p({ children }) {
      const processChildren = (child: React.ReactNode): React.ReactNode => {
        if (typeof child === "string") {
          return renderTextWithCitations(child);
        }
        return child;
      };

      const processedChildren = Array.isArray(children)
        ? children.map((child, i) => <span key={i}>{processChildren(child)}</span>)
        : processChildren(children);

      return <p>{processedChildren}</p>;
    },
    li({ children, node }) {
      const hasCheckbox = node?.children?.some(
        (child: any) => child.tagName === "input" && child.properties?.type === "checkbox"
      );

      const processChildren = (child: React.ReactNode): React.ReactNode => {
        if (typeof child === "string") {
          return renderTextWithCitations(child);
        }
        return child;
      };

      const processedChildren = Array.isArray(children)
        ? children.map((child, i) => <span key={i}>{processChildren(child)}</span>)
        : processChildren(children);

      return (
        <li className={hasCheckbox ? "list-none flex items-start" : ""}>
          {processedChildren}
        </li>
      );
    },
    table({ children }) {
      return (
        <ScrollArea className="w-full whitespace-nowrap rounded-lg border border-border my-4">
          <table className="w-full text-sm">
            {children}
          </table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      );
    },
    thead({ children }) {
      return (
        <thead className="bg-muted/50 border-b border-border">
          {children}
        </thead>
      );
    },
    tbody({ children }) {
      return <tbody className="divide-y divide-border">{children}</tbody>;
    },
    tr({ children }) {
      return <tr className="hover:bg-muted/30 transition-colors">{children}</tr>;
    },
    th({ children }) {
      return (
        <th className="px-4 py-3 text-left font-semibold text-foreground whitespace-normal">
          {children}
        </th>
      );
    },
    td({ children }) {
      const processChildren = (child: React.ReactNode): React.ReactNode => {
        if (typeof child === "string") {
          return renderTextWithCitations(child);
        }
        return child;
      };

      const processedChildren = Array.isArray(children)
        ? children.map((child, i) => <span key={i}>{processChildren(child)}</span>)
        : processChildren(children);

      return (
        <td className="px-4 py-3 text-muted-foreground whitespace-normal min-w-[150px] max-w-[400px]">
          {processedChildren}
        </td>
      );
    },
    del({ children }) {
      return <del className="text-muted-foreground line-through">{children}</del>;
    },
    input({ type, checked, ...props }) {
      if (type === "checkbox") {
        return (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mr-2 h-4 w-4 rounded border-border accent-primary"
            {...props}
          />
        );
      }
      return <input type={type} {...props} />;
    },
  };

  return (
    <div className="relative">
      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:p-0 prose-pre:bg-transparent overflow-visible">
        <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
          {contentWithPlaceholders}
        </ReactMarkdown>
      </div>
      {/* Only show bottom badges for legacy citations without inline markers */}
      {inlineCitations.size === 0 && citations.length > 0 && (
        <CitationBadges citations={citations} />
      )}
    </div>
  );
};

// Memoize MarkdownRenderer - only re-render when content/streaming state changes
export const MemoizedMarkdownRenderer = React.memo(MarkdownRenderer, (prevProps, nextProps) => {
  return (
    prevProps.content === nextProps.content &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.preloadedSources === nextProps.preloadedSources
  );
});

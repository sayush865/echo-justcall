import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { CitationBadges } from "./CitationBadges";
import { parseCitations } from "@/lib/citationParser";
import type { Components } from "react-markdown";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer = ({ content }: MarkdownRendererProps) => {
  const { cleanContent, citations } = useMemo(() => parseCitations(content), [content]);

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
      return (
        <td className="px-4 py-3 text-muted-foreground whitespace-normal min-w-[150px] max-w-[400px]">
          {children}
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
    li({ children, node }) {
      const hasCheckbox = node?.children?.some(
        (child: any) => child.tagName === "input" && child.properties?.type === "checkbox"
      );
      return (
        <li className={hasCheckbox ? "list-none flex items-start" : ""}>
          {children}
        </li>
      );
    },
  };

  return (
    <div>
      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:p-0 prose-pre:bg-transparent">
        <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
          {cleanContent}
        </ReactMarkdown>
      </div>
      <CitationBadges citations={citations} />
    </div>
  );
};

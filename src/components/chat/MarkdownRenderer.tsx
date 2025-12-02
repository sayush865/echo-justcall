import ReactMarkdown from "react-markdown";
import { CodeBlock } from "./CodeBlock";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer = ({ content }: MarkdownRendererProps) => {
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
  };

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-pre:p-0 prose-pre:bg-transparent">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
};

export interface Citation {
  id: string;
  type: "sales" | "support" | "success" | "unknown";
}

export interface ParsedContent {
  cleanContent: string;
  citations: Citation[];
}

// Extract callsid citations from content
const CITATION_PATTERN = /callsid:\s*(CA[a-f0-9]+)/gi;
const GROUPED_CITATION_PATTERN = /\((?:Examples?:?\s*)?(?:sales|support|success)?\s*[–-]?\s*callsid:\s*([^)]+)\)/gi;

export function parseCitations(content: string): ParsedContent {
  const citations: Citation[] = [];
  const seenIds = new Set<string>();
  
  // Detect type context from surrounding text
  const detectType = (text: string, position: number): Citation["type"] => {
    const lookback = text.slice(Math.max(0, position - 100), position).toLowerCase();
    if (lookback.includes("sales")) return "sales";
    if (lookback.includes("support")) return "support";
    if (lookback.includes("success")) return "success";
    return "unknown";
  };

  // Extract individual callsids
  let match;
  const pattern = new RegExp(CITATION_PATTERN.source, "gi");
  while ((match = pattern.exec(content)) !== null) {
    const id = match[1];
    if (!seenIds.has(id)) {
      seenIds.add(id);
      citations.push({
        id,
        type: detectType(content, match.index),
      });
    }
  }

  // Clean the content - remove citation patterns
  let cleanContent = content
    // Remove grouped citation patterns like (Examples: sales – callsid: CA123, CA456)
    .replace(GROUPED_CITATION_PATTERN, "")
    // Remove inline callsid references
    .replace(/\(?\s*callsid:\s*CA[a-f0-9]+(?:,\s*CA[a-f0-9]+)*\s*\)?/gi, "")
    // Remove standalone CA ids that look like citations
    .replace(/\bCA[a-f0-9]{20,}\b/gi, "")
    // Clean up leftover artifacts
    .replace(/\(\s*Examples?:?\s*[–-]?\s*\)/gi, "")
    .replace(/\(\s*\)/g, "")
    // Clean up extra whitespace and newlines
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanContent, citations };
}

export function groupCitationsByType(citations: Citation[]): Record<Citation["type"], Citation[]> {
  return citations.reduce((acc, citation) => {
    if (!acc[citation.type]) {
      acc[citation.type] = [];
    }
    acc[citation.type].push(citation);
    return acc;
  }, {} as Record<Citation["type"], Citation[]>);
}

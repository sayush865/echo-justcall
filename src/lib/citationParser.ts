export interface Citation {
  id: string;
  type: "sales" | "support" | "success" | "unknown";
  sourceNumber?: number;
}

export interface ParsedContent {
  cleanContent: string;
  citations: Citation[];
  inlineCitations: Map<number, Citation>;
}

// Pattern for new [source:N] format
const SOURCE_MARKER_PATTERN = /\[source:(\d+)\]/gi;
// Pattern for Sources section at end
const SOURCES_SECTION_PATTERN = /\n*Sources?:\s*\n((?:\[\d+\][^\n]+\n?)+)/i;
// Pattern for individual source line: [1] CA123abc (Sales)
const SOURCE_LINE_PATTERN = /\[(\d+)\]\s*(CA[a-f0-9]+)[^\n]*\(([^)]+)\)/gi;

// Legacy patterns for backward compatibility
const LEGACY_CITATION_PATTERN = /callsid:\s*(CA[a-f0-9]+)/gi;
const LEGACY_GROUPED_PATTERN = /\((?:Examples?:?\s*)?(?:sales|support|success)?\s*[–-]?\s*callsid:\s*([^)]+)\)/gi;

export function parseCitations(content: string): ParsedContent {
  const citations: Citation[] = [];
  const inlineCitations = new Map<number, Citation>();
  const seenIds = new Set<string>();
  
  // First, try to parse new [source:N] format with Sources section
  const sourcesMatch = content.match(SOURCES_SECTION_PATTERN);
  
  if (sourcesMatch) {
    // Parse the Sources section
    const sourcesText = sourcesMatch[1];
    let match;
    const sourceLinePattern = new RegExp(SOURCE_LINE_PATTERN.source, "gi");
    
    while ((match = sourceLinePattern.exec(sourcesText)) !== null) {
      const sourceNum = parseInt(match[1], 10);
      const callId = match[2];
      const typeText = match[3].toLowerCase();
      
      let type: Citation["type"] = "unknown";
      if (typeText.includes("sales")) type = "sales";
      else if (typeText.includes("support")) type = "support";
      else if (typeText.includes("success")) type = "success";
      
      const citation: Citation = { id: callId, type, sourceNumber: sourceNum };
      
      if (!seenIds.has(callId)) {
        seenIds.add(callId);
        citations.push(citation);
      }
      inlineCitations.set(sourceNum, citation);
    }
    
    // Remove Sources section from content
    let cleanContent = content.replace(SOURCES_SECTION_PATTERN, "").trim();
    
    return { cleanContent, citations, inlineCitations };
  }
  
  // Fallback to legacy parsing for backward compatibility
  const detectType = (text: string, position: number): Citation["type"] => {
    const lookback = text.slice(Math.max(0, position - 100), position).toLowerCase();
    if (lookback.includes("sales")) return "sales";
    if (lookback.includes("support")) return "support";
    if (lookback.includes("success")) return "success";
    return "unknown";
  };

  let match;
  const pattern = new RegExp(LEGACY_CITATION_PATTERN.source, "gi");
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

  let cleanContent = content
    .replace(LEGACY_GROUPED_PATTERN, "")
    .replace(/\(?\s*callsid:\s*CA[a-f0-9]+(?:,\s*CA[a-f0-9]+)*\s*\)?/gi, "")
    .replace(/\bCA[a-f0-9]{20,}\b/gi, "")
    .replace(/\(\s*Examples?:?\s*[–-]?\s*\)/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanContent, citations, inlineCitations };
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

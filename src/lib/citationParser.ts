export interface Citation {
  id: string;
  type: "sales" | "support" | "success" | "unknown";
  subtype: "call" | "meeting" | "unknown"; // Distinguishes calls from meetings
  sourceNumber?: number;
  isStreaming?: boolean; // True when citation is a placeholder during streaming
}

export interface ParsedContent {
  cleanContent: string;
  citations: Citation[];
  inlineCitations: Map<number, Citation>;
}

// Pattern for [source:N], [Source N], or just [N] format - with optional trailing data like page refs
// Matches: [source:1], [Source 1], [1], [Source 1 -20, 21-35], etc.
const SOURCE_MARKER_PATTERN = /\[(?:source[:\s]?)?(\d+)(?:\s*[^\]]+)?\]/gi;
// Pattern for Sources section at end (handles #### Sources:, ## Sources:, Sources:, ---, etc.)
// More flexible to handle horizontal rules, varied whitespace, and markdown formatting
const SOURCES_SECTION_PATTERN = /(?:^|\n)(?:-{3,}\s*\n+)?(?:#{1,4}\s*)?(?:\*\*|__)?Sources?:?(?:\*\*|__)?:?\s*\n((?:\[\d+\][^\n]+\n?)+)[\s\S]*/im;
// Pattern for individual source line: [1] 2d955387-24d2-4f30-88c3-883d8096c1b4 (Sales Call) or (CS Meeting)
// Accepts any hex/UUID format ID (with or without CA prefix), and handles "Call" or "Meeting" in type
const SOURCE_LINE_PATTERN = /\[(\d+)\]\s*([a-f0-9][a-f0-9-]*[a-f0-9])\s*\(([^)]+)\)/gi;

// Legacy patterns for backward compatibility
const LEGACY_CITATION_PATTERN = /callsid:\s*(CA[a-f0-9]+)/gi;
const LEGACY_GROUPED_PATTERN = /\((?:Examples?:?\s*)?(?:sales|support|success)?\s*[–-]?\s*callsid:\s*([^)]+)\)/gi;

/**
 * Parse streaming content to extract placeholder citations from [source:N] markers
 * This is called during streaming BEFORE the Sources section is available
 */
export function parseStreamingCitations(content: string): Map<number, Citation> {
  const inlineCitations = new Map<number, Citation>();
  
  // Find all [source:N], [Source N], or [N] markers in the content (with optional trailing data)
  const markerPattern = /\[(?:source[:\s]?)?(\d+)(?:\s*[^\]]+)?\]/gi;
  let match;
  
  while ((match = markerPattern.exec(content)) !== null) {
    const sourceNum = parseInt(match[1], 10);
    if (!inlineCitations.has(sourceNum)) {
      inlineCitations.set(sourceNum, {
        id: `pending_${sourceNum}`,
        type: "unknown",
        subtype: "unknown",
        sourceNumber: sourceNum,
        isStreaming: true,
      });
    }
  }
  
  // Also check for Sources section if it's started streaming
  const sourcesMatch = content.match(SOURCES_SECTION_PATTERN);
  if (sourcesMatch) {
    const sourcesText = sourcesMatch[1];
    const sourceLinePattern = new RegExp(SOURCE_LINE_PATTERN.source, "gi");
    
    while ((match = sourceLinePattern.exec(sourcesText)) !== null) {
      const sourceNum = parseInt(match[1], 10);
      const callId = match[2];
      const typeText = match[3].toLowerCase();
      
      let type: Citation["type"] = "unknown";
      if (typeText.includes("sales")) type = "sales";
      else if (typeText.includes("support")) type = "support";
      else if (typeText.includes("success") || typeText.includes("cs")) type = "success";
      
      let subtype: Citation["subtype"] = "unknown";
      if (typeText.includes("meeting")) subtype = "meeting";
      else if (typeText.includes("call")) subtype = "call";
      
      // Update placeholder with real data
      inlineCitations.set(sourceNum, {
        id: callId,
        type,
        subtype,
        sourceNumber: sourceNum,
        isStreaming: false,
      });
    }
  }
  
  return inlineCitations;
}

export function parseCitations(content: string): ParsedContent {
  const citations: Citation[] = [];
  const inlineCitations = new Map<number, Citation>();
  const seenIds = new Set<string>();
  
  // First, try to parse new [source:N] format with Sources section
  // Try multiple patterns for robustness
  let sourcesMatch = content.match(SOURCES_SECTION_PATTERN);
  
  // Fallback: Try a more lenient pattern if the strict one fails
  if (!sourcesMatch) {
    const lenientPattern = /(?:\*\*|__)?Sources?:?(?:\*\*|__)?:?\s*\n((?:\[\d+\][^\n]+\n?)+)/im;
    sourcesMatch = content.match(lenientPattern);
  }
  
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
      else if (typeText.includes("success") || typeText.includes("cs")) type = "success";
      
      let subtype: Citation["subtype"] = "unknown";
      if (typeText.includes("meeting")) subtype = "meeting";
      else if (typeText.includes("call")) subtype = "call";
      
      const citation: Citation = { id: callId, type, subtype, sourceNumber: sourceNum, isStreaming: false };
      
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
  
  // Check for streaming placeholders (no Sources section yet)
  const streamingCitations = parseStreamingCitations(content);
  if (streamingCitations.size > 0) {
    // Remove source markers from display but keep citations (handle various formats)
    let cleanContent = content
      .replace(/\[(?:source[:\s]?)?(\d+)(?:\s*[^\]]+)?\]/gi, "%%CITATION_$1%%")
      .trim();
    
    return { cleanContent, citations: [], inlineCitations: streamingCitations };
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
        subtype: "call", // Legacy format was always calls
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

/**
 * Preloaded source from tool results during streaming
 */
export interface PreloadedSource {
  id: string;
  type: string; // 'sales' | 'support' | 'success' | 'cs' etc.
}

/**
 * Map type string from tool name to Citation type
 */
function mapTypeString(typeStr: string): Citation["type"] {
  const lower = typeStr.toLowerCase();
  if (lower.includes("sales")) return "sales";
  if (lower.includes("support")) return "support";
  if (lower.includes("success") || lower.includes("cs")) return "success";
  return "unknown";
}

function mapSubtypeString(typeStr: string): Citation["subtype"] {
  const lower = typeStr.toLowerCase();
  if (lower.includes("meeting")) return "meeting";
  if (lower.includes("call")) return "call";
  return "unknown";
}

/**
 * Merge streaming citations with preloaded sources from tool results
 * Only updates EXISTING citations from streamingCitations - does not add new ones
 * This prevents the source count from inflating with unreferenced tool results
 */
export function mergeWithPreloadedSources(
  streamingCitations: Map<number, Citation>,
  preloadedMap: Map<number, PreloadedSource>
): Map<number, Citation> {
  const merged = new Map(streamingCitations);
  
  // Only update citations that already exist in streamingCitations
  // (i.e., those that have [source:N] markers in the text)
  for (const [num, data] of preloadedMap) {
    if (merged.has(num)) {
      merged.set(num, {
        id: data.id,
        type: mapTypeString(data.type),
        subtype: mapSubtypeString(data.type),
        sourceNumber: num,
        isStreaming: false, // Fully loaded from tool results
      });
    }
  }
  
  return merged;
}

/**
 * Extract source type from n8n tool name
 * e.g., "echo_sales_calls" -> "sales", "echo_cs_meetings" -> "success"
 */
export function extractTypeFromToolName(toolName: string): Citation["type"] {
  const lower = toolName.toLowerCase();
  if (lower.includes("sales")) return "sales";
  if (lower.includes("support")) return "support";
  if (lower.includes("cs") || lower.includes("success")) return "success";
  return "unknown";
}

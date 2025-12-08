-- Add column to track streaming content progress for live continuation
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS streaming_content TEXT DEFAULT '';

-- Clean up existing corrupted messages by stripping JSON metadata
UPDATE messages 
SET content = regexp_replace(
  content, 
  '\{"type":"item","content":"[^"]*","metadata":\{[^}]*\}\}', 
  '', 
  'g'
)
WHERE content LIKE '%{"type":"item"%';
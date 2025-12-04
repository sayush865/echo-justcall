import { z } from 'zod';

/**
 * Input validation schemas for production-grade security
 */

// Chat message validation
export const chatMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, { message: "Message cannot be empty" })
    .max(10000, { message: "Message is too long (max 10,000 characters)" })
    .refine(
      (val) => !containsSuspiciousPatterns(val),
      { message: "Message contains invalid content" }
    ),
  conversationId: z
    .string()
    .uuid({ message: "Invalid conversation ID" })
    .optional()
    .nullable(),
});

// Conversation title validation
export const conversationTitleSchema = z
  .string()
  .trim()
  .min(1, { message: "Title cannot be empty" })
  .max(100, { message: "Title is too long (max 100 characters)" });

// Search query validation
export const searchQuerySchema = z
  .string()
  .trim()
  .max(200, { message: "Search query is too long" });

/**
 * Check for suspicious patterns that might indicate injection attempts
 */
function containsSuspiciousPatterns(input: string): boolean {
  const suspiciousPatterns = [
    // Script injection
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    // SQL injection basics (for logging purposes, not security)
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b.*\b(FROM|INTO|SET|TABLE)\b)/gi,
    // Excessive special characters that might indicate fuzzing
    /[<>{}].*[<>{}].*[<>{}].*[<>{}].*[<>{}]/g,
  ];
  
  return suspiciousPatterns.some(pattern => pattern.test(input));
}

/**
 * Sanitize user input for display (removes potential XSS vectors)
 */
export function sanitizeForDisplay(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate and clean chat message
 */
export function validateChatMessage(message: string): { 
  valid: boolean; 
  cleaned: string; 
  error?: string 
} {
  try {
    const result = chatMessageSchema.shape.message.parse(message);
    return { valid: true, cleaned: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { 
        valid: false, 
        cleaned: '', 
        error: error.errors[0]?.message || 'Invalid message' 
      };
    }
    return { valid: false, cleaned: '', error: 'Validation failed' };
  }
}

/**
 * Check message length and provide feedback
 */
export function getMessageLengthStatus(message: string): {
  length: number;
  maxLength: number;
  percentage: number;
  isNearLimit: boolean;
  isOverLimit: boolean;
} {
  const maxLength = 10000;
  const length = message.length;
  const percentage = (length / maxLength) * 100;
  
  return {
    length,
    maxLength,
    percentage,
    isNearLimit: percentage >= 80 && percentage < 100,
    isOverLimit: percentage >= 100,
  };
}

/**
 * Client-side rate limiter using sliding window algorithm
 * Provides protection against rapid-fire requests
 */

interface RateLimitEntry {
  timestamps: number[];
  blocked: boolean;
  blockedUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitConfig {
  maxRequests: number;      // Max requests in window
  windowMs: number;         // Window size in milliseconds
  blockDurationMs: number;  // How long to block after limit exceeded
}

const defaultConfig: RateLimitConfig = {
  maxRequests: 10,          // 10 requests
  windowMs: 60 * 1000,      // per minute
  blockDurationMs: 30 * 1000, // block for 30 seconds if exceeded
};

export function checkRateLimit(
  key: string, 
  config: Partial<RateLimitConfig> = {}
): { allowed: boolean; retryAfter?: number; remaining: number } {
  const { maxRequests, windowMs, blockDurationMs } = { ...defaultConfig, ...config };
  const now = Date.now();
  
  let entry = rateLimitStore.get(key);
  
  if (!entry) {
    entry = { timestamps: [], blocked: false };
    rateLimitStore.set(key, entry);
  }
  
  // Check if currently blocked
  if (entry.blocked && entry.blockedUntil) {
    if (now < entry.blockedUntil) {
      return { 
        allowed: false, 
        retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
        remaining: 0 
      };
    }
    // Block expired, reset
    entry.blocked = false;
    entry.blockedUntil = undefined;
    entry.timestamps = [];
  }
  
  // Clean old timestamps outside the window
  entry.timestamps = entry.timestamps.filter(ts => now - ts < windowMs);
  
  // Check if under limit
  if (entry.timestamps.length < maxRequests) {
    entry.timestamps.push(now);
    return { 
      allowed: true, 
      remaining: maxRequests - entry.timestamps.length 
    };
  }
  
  // Rate limit exceeded - block
  entry.blocked = true;
  entry.blockedUntil = now + blockDurationMs;
  
  return { 
    allowed: false, 
    retryAfter: Math.ceil(blockDurationMs / 1000),
    remaining: 0 
  };
}

export function resetRateLimit(key: string): void {
  rateLimitStore.delete(key);
}

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    // Remove entries that haven't been used in 5 minutes
    const lastActivity = Math.max(...entry.timestamps, 0);
    if (now - lastActivity > 5 * 60 * 1000) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000); // Run cleanup every minute


import type { Json } from '../types/database';

/**
 * استخراج جی‌سان از متن خروجی جمینی
 * این تابع بلوک‌های مارک‌داون ```json را شناسایی و حذف می‌کند
 */
export function extractJSON<T>(text: string): T {
  try {
    // پاکسازی احتمالی تگ‌های مارک‌داون
    const cleanText = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();
    
    return JSON.parse(cleanText) as T;
  } catch (e) {
    console.error("JSON Extraction Error:", e, "Raw Text:", text);
    throw new Error("دیتای دریافتی معتبر نیست.");
  }
}

/**
 * Normalize a value into DB-safe JSON ( guarantees JSON-serializability at the
 * type level AND at runtime: non-serializable members are dropped exactly as
 * PostgREST would drop them on the wire, instead of failing typecheck or the
 * request. Use at every semantic_profile write boundary.
 */
export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

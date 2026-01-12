/**
 * Schema utilities for normalizing LLM output before validation.
 *
 * PROBLEM: LLMs (Claude, Gemini, Codex) via any interface (CLI, API) may return
 * enum values that don't exactly match the schema (e.g., "simple" vs "SIMPLE").
 *
 * SOLUTION: Normalize enum values BEFORE validation. Provider-agnostic.
 */

/**
 * Normalize enum values in parsed JSON to match schema definitions.
 *
 * Handles:
 * - Case mismatches: "simple" → "SIMPLE"
 * - Whitespace: " SIMPLE " → "SIMPLE"
 * - Common variations: "bug" → "DEBUG", "fix" → "DEBUG"
 *
 * @param {Object} result - Parsed JSON result from LLM
 * @param {Object} schema - JSON schema with enum definitions
 * @returns {Object} Normalized result (mutates and returns same object)
 */
function normalizeEnumValues(result, schema) {
  if (!result || typeof result !== 'object' || !schema?.properties) {
    return result;
  }

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (propSchema.enum && typeof result[key] === 'string') {
      let value = result[key].trim().toUpperCase();

      // DETECT: Model copied the enum list instead of choosing (e.g., "TRIVIAL|SIMPLE|STANDARD")
      if (value.includes('|')) {
        const parts = value.split('|').map((p) => p.trim());
        // Check if this looks like the enum list was copied verbatim
        const matchCount = parts.filter((p) => propSchema.enum.includes(p)).length;
        if (matchCount >= 2) {
          // Model copied the format - pick the first valid option and warn
          const firstValid = parts.find((p) => propSchema.enum.includes(p));
          if (firstValid) {
            console.warn(
              `⚠️  Model copied enum format instead of choosing. Field "${key}" had "${result[key]}", using "${firstValid}"`
            );
            value = firstValid;
          }
        }
      }

      // Find exact match (case-insensitive)
      const match = propSchema.enum.find((e) => e.toUpperCase() === value);
      if (match) {
        result[key] = match;
        continue;
      }

      // Common variations mapping
      const variations = {
        // taskType variations
        BUG: 'DEBUG',
        FIX: 'DEBUG',
        BUGFIX: 'DEBUG',
        BUG_FIX: 'DEBUG',
        INVESTIGATE: 'DEBUG',
        TROUBLESHOOT: 'DEBUG',
        IMPLEMENT: 'TASK',
        BUILD: 'TASK',
        CREATE: 'TASK',
        ADD: 'TASK',
        FEATURE: 'TASK',
        QUESTION: 'INQUIRY',
        ASK: 'INQUIRY',
        EXPLORE: 'INQUIRY',
        RESEARCH: 'INQUIRY',
        UNDERSTAND: 'INQUIRY',
        // complexity variations
        EASY: 'TRIVIAL',
        BASIC: 'SIMPLE',
        MINOR: 'SIMPLE',
        MODERATE: 'STANDARD',
        MEDIUM: 'STANDARD',
        NORMAL: 'STANDARD',
        HARD: 'STANDARD',
        COMPLEX: 'CRITICAL',
        RISKY: 'CRITICAL',
        HIGH_RISK: 'CRITICAL',
        DANGEROUS: 'CRITICAL',
      };

      if (variations[value] && propSchema.enum.includes(variations[value])) {
        result[key] = variations[value];
      }
    }

    // Recursively handle nested objects
    if (propSchema.type === 'object' && propSchema.properties && result[key]) {
      normalizeEnumValues(result[key], propSchema);
    }

    // Handle arrays of objects
    if (propSchema.type === 'array' && propSchema.items?.properties && Array.isArray(result[key])) {
      for (const item of result[key]) {
        normalizeEnumValues(item, propSchema.items);
      }
    }
  }

  return result;
}

module.exports = {
  normalizeEnumValues,
};

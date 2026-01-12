const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Codex structured outputs require additionalProperties: false on ALL object schemas.
 * This function recursively adds that constraint to ensure schema validation passes.
 * @param {Object} schema - JSON Schema object
 * @returns {Object} - Modified schema with additionalProperties: false on all objects
 */
function enforceStrictSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  // Add additionalProperties: false to object types
  if (result.type === 'object') {
    result.additionalProperties = false;
  }

  // Recurse into properties
  if (result.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = enforceStrictSchema(value);
    }
  }

  // Recurse into items (arrays)
  if (result.items) {
    result.items = enforceStrictSchema(schema.items);
  }

  // Recurse into anyOf/oneOf/allOf
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].map(enforceStrictSchema);
    }
  }

  // Recurse into additionalProperties if it's a schema
  if (result.additionalProperties && typeof result.additionalProperties === 'object') {
    result.additionalProperties = enforceStrictSchema(result.additionalProperties);
  }

  return result;
}

function buildCommand(context, options = {}) {
  const { modelSpec, outputFormat, jsonSchema, cwd, autoApprove, cliFeatures = {} } = options;

  const args = ['exec'];
  const cleanup = []; // Files to cleanup after command completes

  if ((outputFormat === 'stream-json' || outputFormat === 'json') && cliFeatures.supportsJson) {
    args.push('--json');
  }

  if (modelSpec?.model) {
    args.push('-m', modelSpec.model);
  }

  if (modelSpec?.reasoningEffort && cliFeatures.supportsConfigOverride) {
    args.push('--config', `model_reasoning_effort="${modelSpec.reasoningEffort}"`);
  }

  if (cwd && cliFeatures.supportsCwd) {
    args.push('-C', cwd);
  }

  if (autoApprove && cliFeatures.supportsAutoApprove) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }

  // Augment context with schema if CLI doesn't support native --output-schema
  let finalContext = context;
  if (jsonSchema && cliFeatures.supportsOutputSchema) {
    // CRITICAL: Codex --output-schema takes a FILE PATH, not a JSON string
    // Write schema to temp file and pass the path
    // Codex requires additionalProperties: false on all object schemas
    const parsedSchema = typeof jsonSchema === 'string' ? JSON.parse(jsonSchema) : jsonSchema;
    const strictSchema = enforceStrictSchema(parsedSchema);
    const schemaStr = JSON.stringify(strictSchema, null, 2);
    const schemaFile = path.join(
      os.tmpdir(),
      `zeroshot-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    fs.writeFileSync(schemaFile, schemaStr);
    cleanup.push(schemaFile);
    args.push('--output-schema', schemaFile);
  } else if (jsonSchema) {
    // CRITICAL: Inject schema into prompt when CLI doesn't support --output-schema
    // Without this, model outputs free-form text instead of JSON
    const schemaStr =
      typeof jsonSchema === 'string' ? jsonSchema : JSON.stringify(jsonSchema, null, 2);
    finalContext =
      context +
      `\n\n## OUTPUT FORMAT (CRITICAL - REQUIRED)

You MUST respond with a JSON object that exactly matches this schema. NO markdown, NO explanation, NO code blocks. ONLY the raw JSON object.

Schema:
\`\`\`json
${schemaStr}
\`\`\`

Your response must be ONLY valid JSON. Start with { and end with }. Nothing else.`;
  }

  args.push(finalContext);

  return {
    binary: 'codex',
    args,
    env: {},
    cleanup, // Temp files to delete after command completes
  };
}

module.exports = {
  buildCommand,
};

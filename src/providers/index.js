const AnthropicProvider = require('./anthropic');
const OpenAIProvider = require('./openai');
const GoogleProvider = require('./google');
const { normalizeProviderName } = require('../../lib/provider-names');

const PROVIDERS = {
  claude: AnthropicProvider,
  codex: OpenAIProvider,
  gemini: GoogleProvider,
};

function getProvider(name) {
  const normalized = normalizeProviderName(name || '');
  const Provider = PROVIDERS[normalized];
  if (!Provider) {
    throw new Error(`Unknown provider: ${name}. Valid: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return new Provider();
}

async function detectProviders() {
  const results = {};
  for (const [name, Provider] of Object.entries(PROVIDERS)) {
    const provider = new Provider();
    results[name] = {
      available: await provider.isAvailable(),
    };
  }
  return results;
}

function listProviders() {
  return Object.keys(PROVIDERS);
}

function stripTimestampPrefix(line) {
  if (!line || typeof line !== 'string') return '';
  const trimmed = line.trim().replace(/\r$/, '');
  if (!trimmed) return '';
  const match = trimmed.match(/^\[(\d{13})\](.*)$/);
  return match ? match[2] : trimmed;
}

function parseChunkWithProvider(provider, chunk) {
  if (!chunk) return [];
  const events = [];
  const lines = chunk.split('\n');

  for (const line of lines) {
    const content = stripTimestampPrefix(line);
    if (!content) continue;
    const event = provider.parseEvent(content);
    if (!event) continue;
    if (Array.isArray(event)) {
      events.push(...event);
    } else {
      events.push(event);
    }
  }

  return events;
}

function parseProviderChunk(providerName, chunk) {
  const provider = getProvider(providerName || 'claude');
  return parseChunkWithProvider(provider, chunk);
}

module.exports = {
  getProvider,
  detectProviders,
  listProviders,
  parseProviderChunk,
  parseChunkWithProvider,
};

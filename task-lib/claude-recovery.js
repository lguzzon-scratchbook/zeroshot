import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export const STREAMING_MODE_ERROR = 'only prompt commands are supported in streaming mode';

export function detectStreamingModeError(line) {
  const trimmed = typeof line === 'string' ? line.trim() : '';
  if (!trimmed.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      parsed.type === 'result' &&
      parsed.is_error === true &&
      Array.isArray(parsed.errors) &&
      parsed.errors.includes(STREAMING_MODE_ERROR) &&
      typeof parsed.session_id === 'string'
    ) {
      return {
        sessionId: parsed.session_id,
        line: trimmed,
      };
    }
  } catch {
    // Ignore parse errors - not JSON
  }

  return null;
}

function findSessionJsonlPath(sessionId) {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const projectsDir = join(claudeDir, 'projects');
  if (!existsSync(projectsDir)) return null;

  const target = `${sessionId}.jsonl`;
  const queue = [projectsDir];

  while (queue.length > 0) {
    const dir = queue.pop();
    if (!dir) continue;

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name === target) {
        return join(dir, entry.name);
      }
      if (entry.isDirectory()) {
        queue.push(join(dir, entry.name));
      }
    }
  }

  return null;
}

export function recoverStructuredOutput(sessionId) {
  const jsonlPath = findSessionJsonlPath(sessionId);
  if (!jsonlPath) return null;

  let fileContents;
  try {
    fileContents = readFileSync(jsonlPath, 'utf8');
  } catch {
    return null;
  }

  const lines = fileContents.split('\n');
  let structuredOutput = null;
  let usage = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const message = entry?.message;
      const content = message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (
          block?.type === 'tool_use' &&
          block?.name === 'StructuredOutput' &&
          block?.input
        ) {
          structuredOutput = block.input;
          if (message?.usage && typeof message.usage === 'object') {
            usage = message.usage;
          }
        }
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  if (!structuredOutput) return null;

  const payload = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    structured_output: structuredOutput,
    session_id: sessionId,
  };

  if (usage) {
    payload.usage = usage;
  }

  return {
    payload,
    sourcePath: jsonlPath,
  };
}

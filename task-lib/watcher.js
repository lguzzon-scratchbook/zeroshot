#!/usr/bin/env node

/**
 * Watcher process - spawns and monitors a CLI process
 * Runs detached from parent, updates task status on completion
 */

import { spawn } from 'child_process';
import { appendFileSync } from 'fs';
import { updateTask } from './store.js';
import { detectStreamingModeError, recoverStructuredOutput } from './claude-recovery.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { normalizeProviderName } = require('../lib/provider-names');

const [, , taskId, cwd, logFile, argsJson, configJson] = process.argv;
const args = JSON.parse(argsJson);
const config = configJson ? JSON.parse(configJson) : {};

function log(msg) {
  appendFileSync(logFile, msg);
}

const providerName = normalizeProviderName(config.provider || 'claude');
const enableRecovery = providerName === 'claude';

const env = { ...process.env, ...(config.env || {}) };
const command = config.command || 'claude';
const finalArgs = [...args];

const child = spawn(command, finalArgs, {
  cwd,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

updateTask(taskId, { pid: child.pid });

const silentJsonMode =
  config.outputFormat === 'json' && config.jsonSchema && config.silentJsonOutput && enableRecovery;

let finalResultJson = null;
let streamingModeError = null;

let stdoutBuffer = '';

child.stdout.on('data', (data) => {
  const chunk = data.toString();
  const timestamp = Date.now();

  if (silentJsonMode) {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      if (enableRecovery) {
        const detectedError = detectStreamingModeError(line);
        if (detectedError) {
          streamingModeError = { ...detectedError, timestamp };
          continue;
        }
      }
      try {
        const json = JSON.parse(line);
        if (json.structured_output) {
          finalResultJson = line;
        }
      } catch {
        // Not JSON, skip
      }
    }
  } else {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      if (enableRecovery) {
        const detectedError = detectStreamingModeError(line);
        if (detectedError) {
          streamingModeError = { ...detectedError, timestamp };
          continue;
        }
      }
      log(`[${timestamp}]${line}\n`);
    }
  }
});

let stderrBuffer = '';

child.stderr.on('data', (data) => {
  const chunk = data.toString();
  const timestamp = Date.now();

  stderrBuffer += chunk;
  const lines = stderrBuffer.split('\n');
  stderrBuffer = lines.pop() || '';

  for (const line of lines) {
    log(`[${timestamp}]${line}\n`);
  }
});

child.on('close', async (code, signal) => {
  const timestamp = Date.now();

  if (stdoutBuffer.trim()) {
    if (enableRecovery) {
      const detectedError = detectStreamingModeError(stdoutBuffer);
      if (detectedError) {
        streamingModeError = { ...detectedError, timestamp };
      } else if (silentJsonMode) {
        try {
          const json = JSON.parse(stdoutBuffer);
          if (json.structured_output) {
            finalResultJson = stdoutBuffer;
          }
        } catch {
          // Not valid JSON
        }
      } else {
        log(`[${timestamp}]${stdoutBuffer}\n`);
      }
    } else if (!silentJsonMode) {
      log(`[${timestamp}]${stdoutBuffer}\n`);
    }
  }

  if (stderrBuffer.trim()) {
    log(`[${timestamp}]${stderrBuffer}\n`);
  }

  let recovered = null;
  if (enableRecovery && code !== 0 && streamingModeError?.sessionId) {
    recovered = recoverStructuredOutput(streamingModeError.sessionId);
    if (recovered?.payload) {
      const recoveredLine = JSON.stringify(recovered.payload);
      if (silentJsonMode) {
        finalResultJson = recoveredLine;
      } else {
        log(`[${timestamp}]${recoveredLine}\n`);
      }
    } else if (streamingModeError.line) {
      if (silentJsonMode) {
        log(streamingModeError.line + '\n');
      } else {
        log(`[${streamingModeError.timestamp}]${streamingModeError.line}\n`);
      }
    }
  }

  if (silentJsonMode && finalResultJson) {
    log(finalResultJson + '\n');
  }

  if (config.outputFormat !== 'json') {
    log(`\n${'='.repeat(50)}\n`);
    log(`Finished: ${new Date().toISOString()}\n`);
    log(`Exit code: ${code}, Signal: ${signal}\n`);
  }

  const resolvedCode = recovered?.payload ? 0 : code;
  const status = resolvedCode === 0 ? 'completed' : 'failed';
  try {
    await updateTask(taskId, {
      status,
      exitCode: resolvedCode,
      error: resolvedCode === 0 ? null : signal ? `Killed by ${signal}` : null,
    });
  } catch (updateError) {
    log(`[${Date.now()}][ERROR] Failed to update task status: ${updateError.message}\n`);
  }
  process.exit(0);
});

child.on('error', async (err) => {
  log(`\nError: ${err.message}\n`);
  try {
    await updateTask(taskId, { status: 'failed', error: err.message });
  } catch (updateError) {
    log(`[${Date.now()}][ERROR] Failed to update task status: ${updateError.message}\n`);
  }
  process.exit(1);
});

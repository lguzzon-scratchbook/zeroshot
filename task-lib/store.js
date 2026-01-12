import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { TASKS_DIR, TASKS_FILE, LOGS_DIR, SCHEDULES_FILE } from './config.js';
import { generateName } from './name-generator.js';
import lockfile from 'proper-lockfile';

// Stale lock timeout - 5 seconds is plenty for JSON read/write
const LOCK_STALE_MS = 5000;

// Lock options with async retry support
const LOCK_OPTIONS = {
  stale: LOCK_STALE_MS,
  retries: {
    retries: 20,
    minTimeout: 100,
    maxTimeout: 200,
    randomize: true,
  },
};

/**
 * Remove lock file if it's stale (older than LOCK_STALE_MS)
 */
function cleanStaleLock(filePath) {
  const lockPath = filePath + '.lock';
  try {
    if (existsSync(lockPath)) {
      const age = Date.now() - statSync(lockPath).mtimeMs;
      if (age > LOCK_STALE_MS) {
        unlinkSync(lockPath);
      }
    }
  } catch {
    // Ignore - another process may have cleaned it
  }
}

export function ensureDirs() {
  if (!existsSync(TASKS_DIR)) mkdirSync(TASKS_DIR, { recursive: true });
  if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * Read tasks.json (no locking - use for read-only operations)
 */
export function loadTasks() {
  ensureDirs();
  if (!existsSync(TASKS_FILE)) return {};
  const content = readFileSync(TASKS_FILE, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `CRITICAL: tasks.json is corrupted and cannot be parsed. Error: ${error.message}. Content: ${content.slice(0, 200)}...`
    );
  }
}

/**
 * Write tasks.json (no locking - internal use only)
 */
export function saveTasks(tasks) {
  ensureDirs();
  writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}

/**
 * Atomic read-modify-write with file locking
 * @param {Function} modifier - Function that receives tasks object and returns modified tasks
 * @returns {Promise<any>} - Return value from modifier function
 */
export async function withTasksLock(modifier) {
  ensureDirs();

  // Create file if it doesn't exist (needed for locking)
  if (!existsSync(TASKS_FILE)) {
    writeFileSync(TASKS_FILE, '{}');
  }

  let release;
  try {
    // Clean stale locks from crashed processes
    cleanStaleLock(TASKS_FILE);

    // Acquire lock with async API (proper retries without CPU spin-wait)
    release = await lockfile.lock(TASKS_FILE, LOCK_OPTIONS);

    // Read current state
    const content = readFileSync(TASKS_FILE, 'utf-8');
    let tasks;
    try {
      tasks = JSON.parse(content);
    } catch (error) {
      throw new Error(`CRITICAL: tasks.json is corrupted. Error: ${error.message}`);
    }

    // Apply modification
    const result = modifier(tasks);

    // Write back
    writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));

    return result;
  } finally {
    if (release) {
      await release();
    }
  }
}

export function getTask(id) {
  const tasks = loadTasks();
  return tasks[id];
}

export function updateTask(id, updates) {
  return withTasksLock((tasks) => {
    if (!tasks[id]) return null;
    tasks[id] = {
      ...tasks[id],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    return tasks[id];
  });
}

export function addTask(task) {
  return withTasksLock((tasks) => {
    tasks[task.id] = task;
    return task;
  });
}

export async function removeTask(id) {
  await withTasksLock((tasks) => {
    delete tasks[id];
  });
}

export function generateId() {
  return generateName('task');
}

export function generateScheduleId() {
  return generateName('sched');
}

// Schedule management - same pattern with locking

async function withSchedulesLock(modifier) {
  ensureDirs();

  if (!existsSync(SCHEDULES_FILE)) {
    writeFileSync(SCHEDULES_FILE, '{}');
  }

  let release;
  try {
    // Clean stale locks from crashed processes
    cleanStaleLock(SCHEDULES_FILE);

    // Acquire lock with async API (proper retries without CPU spin-wait)
    release = await lockfile.lock(SCHEDULES_FILE, LOCK_OPTIONS);

    const content = readFileSync(SCHEDULES_FILE, 'utf-8');
    let schedules;
    try {
      schedules = JSON.parse(content);
    } catch (error) {
      throw new Error(`CRITICAL: schedules.json is corrupted. Error: ${error.message}`);
    }

    const result = modifier(schedules);
    writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));

    return result;
  } finally {
    if (release) {
      await release();
    }
  }
}

export function loadSchedules() {
  ensureDirs();
  if (!existsSync(SCHEDULES_FILE)) return {};
  const content = readFileSync(SCHEDULES_FILE, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `CRITICAL: schedules.json is corrupted and cannot be parsed. Error: ${error.message}. Content: ${content.slice(0, 200)}...`
    );
  }
}

export function saveSchedules(schedules) {
  ensureDirs();
  writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules, null, 2));
}

export function getSchedule(id) {
  const schedules = loadSchedules();
  return schedules[id];
}

export function addSchedule(schedule) {
  return withSchedulesLock((schedules) => {
    schedules[schedule.id] = schedule;
    return schedule;
  });
}

export function updateSchedule(id, updates) {
  return withSchedulesLock((schedules) => {
    if (!schedules[id]) return null;
    schedules[id] = {
      ...schedules[id],
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    return schedules[id];
  });
}

export async function removeSchedule(id) {
  await withSchedulesLock((schedules) => {
    delete schedules[id];
  });
}

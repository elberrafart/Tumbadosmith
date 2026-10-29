// Per-riff progress in IndexedDB, with an in-memory fallback when it is unavailable.

export interface RiffProgress {
  id: string;
  bestAccuracy: number;
  bestAccuracySpeed: number;
  /** Highest speed with a clean (>= 90%) practice pass or full play. */
  bestCleanSpeed: number;
  plays: number;
  lastPlayed: number;
}

const DB = 'tumbadosmith';
const STORE = 'progress';
const memory = new Map<string, RiffProgress>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function getAllProgress(): Promise<Map<string, RiffProgress>> {
  const db = await open();
  if (!db) return new Map(memory);
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(new Map((req.result as RiffProgress[]).map((p) => [p.id, p])));
    req.onerror = () => resolve(new Map(memory));
  });
}

export async function getProgress(id: string): Promise<RiffProgress | undefined> {
  return (await getAllProgress()).get(id);
}

/** Merge a finished run into stored progress; returns the new record and whether it beat the old best. */
export async function recordRun(
  id: string,
  run: { accuracy: number; speed: number; cleanSpeed: number },
): Promise<{ progress: RiffProgress; newBest: boolean }> {
  const old = await getProgress(id);
  const newBest = !old || run.accuracy > old.bestAccuracy;
  const progress: RiffProgress = {
    id,
    bestAccuracy: newBest ? run.accuracy : old!.bestAccuracy,
    bestAccuracySpeed: newBest ? run.speed : old!.bestAccuracySpeed,
    bestCleanSpeed: Math.max(old?.bestCleanSpeed ?? 0, run.cleanSpeed),
    plays: (old?.plays ?? 0) + 1,
    lastPlayed: Date.now(),
  };
  memory.set(id, progress);
  const db = await open();
  if (db) {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(progress);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  return { progress, newBest };
}

export interface ParallelTask<T> {
  id: string;
  sequenceIndex?: number;
  run: () => Promise<T>;
}

export interface ParallelResult<T> {
  id: string;
  sequenceIndex?: number;
  result?: T;
  error?: string;
}

/**
 * Run tasks in parallel with bounded concurrency.
 * Each completed task triggers onTaskDone immediately (for incremental UI).
 */
export async function runParallel<T>(
  tasks: ParallelTask<T>[],
  concurrency = 6,
  onProgress?: (done: number, total: number, id: string) => void,
  onTaskDone?: (id: string, result: T | undefined, done: number, total: number, seqIdx?: number) => void,
): Promise<ParallelResult<T>[]> {
  const results: ParallelResult<T>[] = [];
  let index = 0;
  let doneCount = 0;

  async function worker() {
    while (index < tasks.length) {
      const task = tasks[index++];
      let taskResult: T | undefined;
      try {
        taskResult = await task.run();
        results.push({ id: task.id, result: taskResult, sequenceIndex: task.sequenceIndex });
      } catch (e) {
        results.push({ id: task.id, error: (e as Error).message, sequenceIndex: task.sequenceIndex });
        console.error(`[ParallelRunner] Task ${task.id} failed:`, e);
      }
      doneCount++;
      onProgress?.(doneCount, tasks.length, task.id);
      onTaskDone?.(task.id, taskResult, doneCount, tasks.length, task.sequenceIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  results.sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
  return results;
}

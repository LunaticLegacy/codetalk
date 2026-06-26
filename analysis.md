## Why `codetalk semantic` creates N "agent" tasks upfront regardless of `--parallel`

The root cause is in **`src/semantic.ts`**, lines 110–135 inside `runSemanticMap()`:

```typescript
const tasks = inventory.map((item, index) => async () => {
    // ... body referencing item, index, inventory, cache, etc.
});

const workerCount = resolveSemanticParallel(options.parallelMode, options.parallel, inventory.length);
const analyses = await runLimited(tasks, workerCount);
```

### What happens

1. **`inventory.map(...)` creates N closures eagerly** — one per function/method in the inventory, regardless of the `--parallel` setting. If your repo has 500 functions, it builds 500 `async () => { ... }` closures immediately at the point of the `.map()` call.

2. **Each closure captures a full `SemanticInventoryItem`** — which includes a `sourceExcerpt` (up to 5,000 chars) and a `contextExcerpt` (up to 12,000 chars) of surrounding source code, plus the entire `inventory` array reference and shared mutable state (`startedCount`, `finishedCount`, `spinnerIndex`). So for N items, you have N copies of large string slices held in memory.

3. **`runLimited()` only limits *concurrent execution*** — it spawns `workerCount` workers that consume from a shared `nextIndex` counter, but the closures *already exist*. The ~40KB memory per closure (excerpts, etc.) is committed upfront.

### Why `--parallel` feels ignored

- **`--parallel 4`** still builds N closures → N strings → N panel agent rows (added lazily when each task starts, but the closures exist)
- **`--parallel MAX`** fans out to all N immediately via `Math.min(40, totalItems)` in `resolveSemanticParallel()`

The comment in the code even says:

```typescript
// Add agent row only when it starts running (not for all N upfront)
panel.add(agentId, ...);     // ← inside the task function, so rows appear lazily
```

But the **task function objects themselves** are not lazy — all N are created by `.map()` before any execution begins.

### The fix

Replace the eager `inventory.map()` with a **lazy generator / streaming task factory** that creates closures only as workers consume them. For example, instead of:

```typescript
const tasks = inventory.map((item, index) => async () => { ... });
const analyses = await runLimited(tasks, workerCount);
```

Use a **task iterator** that produces closures on-demand:

```typescript
async function* taskGenerator() {
  for (let index = 0; index < inventory.length; index++) {
    yield async () => {
      const item = inventory[index];
      // ... rest of the closure body
    };
  }
}

const analyses = await runLazy(generator, workerCount);
```

Where `runLazy` consumes from the `AsyncGenerator` instead of a pre-built array. This way only `workerCount` closures exist at any time.

Alternatively, a simpler fix: **avoid capturing `item` and `index` in each closure** by having `runLimited` dispatch indices to workers and have each worker look up `inventory[current]` itself:

```typescript
async function runLimited<T>(inventory: SemanticInventoryItem[], worker: (item: SemanticInventoryItem, index: number) => Promise<T>, parallel: number): Promise<T[]> {
  const results: T[] = new Array(inventory.length);
  let nextIndex = 0;
  const workerCount = Math.min(parallel, inventory.length);
  
  async function workerFn(): Promise<void> {
    while (nextIndex < inventory.length) {
      const current = nextIndex++;
      results[current] = await worker(inventory[current], current);
    }
  }
  
  await Promise.all(Array.from({ length: workerCount }, () => workerFn()));
  return results;
}
```

Then callers pass a factory function instead of a pre-built array of closures. This way **only `workerCount` closures exist at runtime**, not N.

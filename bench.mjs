// bench.mjs — public benchmark suite for git.pp fold ports
//
// Usage: node bench.mjs <path-to-port> [iterations]
//
// Workloads:
//   - Live poc-quilt-1 (8 records, fetched from the deployment)
//   - Synthetic 1000-record deep chain
//   - Synthetic 1000-record wide tree
//   - Synthetic 1000-record contested keys
//   - Synthetic 1000-record witness-heavy
//
// Reports: mean / p50 / p99 for fold time, closure-root time, memory delta.

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const portPath = process.argv[2];
const iters = parseInt(process.argv[3] || "10", 10);

if (!portPath) {
  console.error("usage: node bench.mjs <path-to-port> [iterations]");
  process.exit(1);
}

const port = await import(pathToFileURL(resolve(portPath)).href);
if (typeof port.closureRoot !== "function" || typeof port.derive !== "function") {
  console.error(`port at ${portPath} does not export closureRoot() and derive()`);
  process.exit(2);
}

// Workload generators
function makeDeepChain(n) {
  const records = [{ id: "genesis", kind: "task", parents: [], effects: { "project": "bench" } }];
  for (let i = 1; i < n; i++) {
    records.push({
      id: `task-${i}`,
      kind: "task",
      parents: [`task-${i - 1}`],
      effects: { [`k${i}`]: i },
    });
  }
  return records;
}

function makeWideTree(n) {
  // 1 root + 999 children
  const records = [{ id: "root", kind: "task", parents: [], effects: { "project": "bench" } }];
  for (let i = 1; i < n; i++) {
    records.push({
      id: `t${i}`,
      kind: "task",
      parents: ["root"],
      effects: { [`k${i}`]: i },
    });
  }
  return records;
}

function makeContested(n) {
  // 1 root + n-1 tasks all setting the same key with different values
  const records = [{ id: "root", kind: "task", parents: [], effects: { "project": "bench" } }];
  for (let i = 1; i < n; i++) {
    records.push({
      id: `t${i}`,
      kind: "task",
      parents: ["root"],
      effects: { "config.timeout": i },
    });
  }
  // 1 override at the end that wins
  records.push({
    id: "override-final",
    kind: "override",
    parents: ["t1"],
    effects: { "config.timeout": 9999 },
    reason: "bench",
  });
  records[records.length - 1].parents = records.slice(1, n).map(r => r.id);
  return records;
}

function makeWitnessHeavy(n) {
  // 1 root + 1 task + n-2 witnesses
  const records = [{ id: "root", kind: "task", parents: [], effects: { "project": "bench" } }];
  records.push({ id: "task-1", kind: "task", parents: ["root"], effects: { "x": 1 } });
  for (let i = 2; i < n; i++) {
    records.push({
      id: `witness-${i}`,
      kind: "witness",
      parents: ["root"],
      effects: { [`env.k${i}`]: i },
    });
  }
  return records;
}

async function loadLiveSet() {
  const r = await fetch("https://gitpp.superinstance.dev/api/records?project=poc-quilt-1");
  if (!r.ok) throw new Error("could not fetch live poc-quilt-1 set");
  const j = await r.json();
  return j.records;
}

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  return { mean, p50, p99, min: sorted[0], max: sorted[sorted.length - 1] };
}

async function bench(name, records, at) {
  const foldTimes = [];
  const rootTimes = [];
  let lastRoot = null;
  let memBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    const d = port.derive(records);
    const t1 = performance.now();
    foldTimes.push(t1 - t0);

    const t2 = performance.now();
    const root = await port.closureRoot(records, at);
    const t3 = performance.now();
    rootTimes.push(t3 - t2);
    lastRoot = root;
  }
  let memAfter = process.memoryUsage().heapUsed;
  const memDelta = ((memAfter - memBefore) / 1024 / 1024).toFixed(2);
  return {
    name,
    records: records.length,
    at,
    closureRoot: lastRoot,
    foldMs: stats(foldTimes),
    rootMs: stats(rootTimes),
    memDeltaMb: memDelta,
  };
}

async function main() {
  console.log(`Port: ${portPath}`);
  console.log(`Iterations: ${iters}`);
  console.log();

  // Live set
  try {
    const records = await loadLiveSet();
    const r = await bench("Live poc-quilt-1 (live deployment)", records, "task-c");
    console.log(`${r.name}:`);
    console.log(`  closure root at ${r.at}: ${r.closureRoot}`);
    console.log(`  fold (derive + state + conflicts): mean ${r.foldMs.mean.toFixed(2)} ms, p50 ${r.foldMs.p50.toFixed(2)} ms, p99 ${r.foldMs.p99.toFixed(2)} ms`);
    console.log(`  closure root (closure + leaves + hash): mean ${r.rootMs.mean.toFixed(2)} ms, p50 ${r.rootMs.p50.toFixed(2)} ms, p99 ${r.rootMs.p99.toFixed(2)} ms`);
    console.log(`  memory delta: ${r.memDeltaMb} MB`);
    console.log();
  } catch (e) {
    console.log(`Live set unavailable: ${e.message}`);
    console.log();
  }

  // Synthetic workloads
  const N = 1000;
  for (const [name, gen, at] of [
    ["Synthetic deep chain (N=1000)", makeDeepChain, "task-999"],
    ["Synthetic wide tree (N=1000)", makeWideTree, "t500"],
    ["Synthetic contested keys (N=1000)", makeContested, "override-final"],
    ["Synthetic witness-heavy (N=1000)", makeWitnessHeavy, "witness-500"],
  ]) {
    const records = gen(N);
    const r = await bench(name, records, at);
    console.log(`${r.name}:`);
    console.log(`  closure root: mean ${r.rootMs.mean.toFixed(2)} ms, p50 ${r.rootMs.p50.toFixed(2)} ms, p99 ${r.rootMs.p99.toFixed(2)} ms`);
    console.log(`  fold: mean ${r.foldMs.mean.toFixed(2)} ms, p50 ${r.foldMs.p50.toFixed(2)} ms, p99 ${r.foldMs.p99.toFixed(2)} ms`);
    console.log(`  memory delta: ${r.memDeltaMb} MB`);
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

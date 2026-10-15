# gitpp-bench

> A benchmark suite for the git.pp fold ports. Measures fold time, closure-root time, and memory against the live `poc-quilt-1` set and a synthetic 1,000-record set.

## Why

The hub's `RESULTS.md` pins measured numbers for the live deployment (fold time 1.8 ms at 62 records, live-read 2.42 s full). A separate, public benchmark suite lets port authors verify their port's performance against the same workloads.

## What's in it

- `bench.mjs` — the benchmark runner. Imports any port that exports `closureRoot` and `derive`, then runs the standard workloads.
- `workloads/` — the synthetic record sets (1,000 records with various patterns: deep chains, wide trees, contested keys, witness-heavy, override-heavy).
- `live.test.js` — fetches the live `poc-quilt-1` set and runs the benchmarks against it.
- `synthetic.test.js` — runs the benchmarks against the synthetic workloads.

## Usage

```bash
node bench.mjs <path-to-port> [iterations=10]
```

A typical run prints:

```
Port: gitpp-js
Live poc-quilt-1 (8 records, 10 iterations):
  closure root at task-c: 60effe23970d8a5cc837636c44685502361288c1f00577e9addfa10cbd4fc91d
  fold (derive + state + conflicts): mean 0.42 ms, p50 0.40 ms, p99 0.78 ms
  closure root (closure + leaves + hash): mean 0.18 ms, p50 0.17 ms, p99 0.31 ms
  memory delta: ~0.8 MB

Synthetic 1000-record deep chain (10 iterations):
  closure root: mean 12.4 ms, p50 11.9 ms, p99 14.2 ms
  fold: mean 8.7 ms, p50 8.5 ms, p99 10.1 ms
  memory delta: ~6.2 MB
```

## Pass criterion

The benchmark is informational; there's no "passing" threshold. The hub's `RESULTS.md` pins the production numbers; this suite is for any port author to compare their numbers against the same workloads.

A regression (e.g. fold time goes from 1 ms to 100 ms) is a real signal. Use the workload scaling factor (records / fold time) to detect: a port that takes 10x as long for the same workload has a 10x slowdown.

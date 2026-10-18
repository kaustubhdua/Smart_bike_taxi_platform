# Reproducible DSA benchmark

The `C++ build and tests` workflow builds the opt-in benchmark in Release mode and uploads a raw CSV artifact for each commit.

## Run locally

```sh
cmake -S . -B build-bench -DSMART_BIKE_TAXI_BUILD_BENCHMARKS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build-bench --target smart_bike_taxi_benchmark --parallel
./build-bench/smart_bike_taxi_benchmark 1000 1000 > benchmark-results.csv
```

The benchmark uses a deterministic 1,000-node graph and 1,000 repetitions by default in CI. It measures route-query time and custom hash-table versus `std::unordered_map` lookup time, then emits one CSV row with a checksum to help prevent dead-code elimination.

## Interpreting results

- Download the `saarthi-benchmark-<commit SHA>` artifact from the workflow run to inspect the exact raw measurements.
- Timing varies by runner, compiler, and system load. Compare repeated runs on the same runner class before drawing conclusions.
- Do not claim the custom hash table is faster unless repeated measurements support that claim.
- These are microbenchmarks of the academic DSA core, not production dispatch throughput or end-to-end ride latency.


## Recorded sample

A real GitHub Actions run on **2026-10-18** (Ubuntu 24.04, Release build, default GCC toolchain, 1,000 graph nodes, 1,000 repetitions) produced the checked-in sample `results/ubuntu-latest-2026-10-18.csv`. The source run is [workflow run 39116464262](https://github.com/kaustubhdua/Smart_bike_taxi_platform/actions/runs/39116464262), commit `008cd311637c9c481aacafe338f0d71d5790df17`.

| Measurement | Single-run result |
|---|---:|
| 1,000 route queries | 77.098 ms |
| Custom hash-table lookup, 1,000 operations | 0.074 ms |
| `std::unordered_map` lookup, 1,000 operations | 0.064 ms |

This is one sample, not a statistically reliable performance claim. In this run, `std::unordered_map` was faster for the lookup microbenchmark; repeat runs and variance analysis are needed before drawing general conclusions. The benchmark is not a measurement of production dispatch or end-to-end ride latency.

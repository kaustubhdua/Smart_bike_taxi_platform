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

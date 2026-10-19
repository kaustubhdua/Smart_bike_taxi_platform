#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

#include "graph/Graph.h"
#include "models/Models.h"
#include "structures/HashTable.h"

int main(int argc, char** argv) {
    const int nodeCount = argc > 1 ? std::max(10, std::atoi(argv[1])) : 1000;
    const int repetitions = argc > 2 ? std::max(1, std::atoi(argv[2])) : 1000;

    Graph graph;
    for (int i = 0; i < nodeCount; ++i) {
        if (!graph.addLocation("N" + std::to_string(i))) return 2;
    }
    for (int i = 1; i < nodeCount; ++i) {
        if (!graph.addRoad("N" + std::to_string(i - 1),
                           "N" + std::to_string(i), 1.0)) return 3;
    }
    for (int i = 0; i + 7 < nodeCount; i += 7) {
        graph.addRoad("N" + std::to_string(i),
                      "N" + std::to_string(i + 7), 5.0);
    }

    HashTable<Rider> custom(static_cast<std::size_t>(nodeCount) * 2 + 1);
    std::unordered_map<std::string, Rider> standard;
    for (int i = 0; i < nodeCount; ++i) {
        const auto id = "R" + std::to_string(i);
        const Rider rider{id, "Rider " + std::to_string(i), "demo"};
        if (!custom.insert(id, rider)) return 4;
        standard.emplace(id, rider);
    }

    volatile std::size_t checksum = 0;
    const auto graphStart = std::chrono::steady_clock::now();
    for (int i = 0; i < repetitions; ++i) {
        const auto route = graph.shortestPath("N0", "N" + std::to_string(nodeCount - 1 - (i % nodeCount)));
        checksum += route.path.size();
    }
    const auto graphEnd = std::chrono::steady_clock::now();

    const auto customStart = std::chrono::steady_clock::now();
    for (int i = 0; i < repetitions; ++i) {
        const auto* rider = custom.find("R" + std::to_string(i % nodeCount));
        checksum += rider ? rider->name.size() : 0;
    }
    const auto customEnd = std::chrono::steady_clock::now();

    const auto standardStart = std::chrono::steady_clock::now();
    for (int i = 0; i < repetitions; ++i) {
        const auto found = standard.find("R" + std::to_string(i % nodeCount));
        checksum += found == standard.end() ? 0 : found->second.name.size();
    }
    const auto standardEnd = std::chrono::steady_clock::now();

    const auto ms = [](auto begin, auto end) {
        return std::chrono::duration<double, std::milli>(end - begin).count();
    };
    std::cout << "dataset_nodes,repetitions,graph_route_ms,custom_hash_lookup_ms,"
                 "unordered_map_lookup_ms,checksum\n";
    std::cout << nodeCount << ',' << repetitions << ','
              << std::fixed << std::setprecision(3)
              << ms(graphStart, graphEnd) << ','
              << ms(customStart, customEnd) << ','
              << ms(standardStart, standardEnd) << ','
              << checksum << '\n';
    return 0;
}

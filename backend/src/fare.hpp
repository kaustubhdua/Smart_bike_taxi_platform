#pragma once

#include <limits>
#include <stdexcept>

namespace rideforge_fare {

// Demo-only tariff: ₹20 base fare plus ₹11 per routed kilometre.
// All amounts are integer paise; distance charges are rounded up to one paise.
struct Breakdown {
    int base_fare_paise{};
    int distance_fare_paise{};
    int total_fare_paise{};
};

inline Breakdown calculate_demo_fare(int distance_meters) {
    if (distance_meters <= 0) {
        throw std::invalid_argument("route distance must be positive");
    }

    constexpr int base_fare_paise = 2000;
    constexpr long long distance_rate_paise_per_km = 1100;
    const long long distance_fare =
        (static_cast<long long>(distance_meters) * distance_rate_paise_per_km + 999LL) / 1000LL;
    const long long total = static_cast<long long>(base_fare_paise) + distance_fare;
    if (distance_fare > std::numeric_limits<int>::max() ||
        total > std::numeric_limits<int>::max()) {
        throw std::invalid_argument("route is too long for a supported fare");
    }

    return {base_fare_paise, static_cast<int>(distance_fare), static_cast<int>(total)};
}

} // namespace rideforge_fare

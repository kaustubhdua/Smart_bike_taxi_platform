#include "../src/fare.hpp"

#include <cassert>
#include <iostream>
#include <limits>
#include <stdexcept>

namespace {

template <typename Fn>
bool throws_invalid_argument(Fn&& fn) {
    try {
        fn();
    } catch (const std::invalid_argument&) {
        return true;
    }
    return false;
}

void fare_rounding_and_breakdown() {
    using rideforge_fare::calculate_demo_fare;

    const auto one_meter = calculate_demo_fare(1);
    assert(one_meter.base_fare_paise == 2000);
    assert(one_meter.distance_fare_paise == 2);
    assert(one_meter.total_fare_paise == 2002);

    const auto nine_hundred_ninety_nine_meters = calculate_demo_fare(999);
    assert(nine_hundred_ninety_nine_meters.distance_fare_paise == 1099);
    assert(nine_hundred_ninety_nine_meters.total_fare_paise == 3099);

    const auto one_km = calculate_demo_fare(1000);
    assert(one_km.distance_fare_paise == 1100);
    assert(one_km.total_fare_paise == 3100);

    const auto over_one_km = calculate_demo_fare(1001);
    assert(over_one_km.distance_fare_paise == 1102);
    assert(over_one_km.total_fare_paise == 3102);

    const auto two_point_five_km = calculate_demo_fare(2500);
    assert(two_point_five_km.distance_fare_paise == 2750);
    assert(two_point_five_km.total_fare_paise == 4750);
}

void invalid_and_overflow_distances() {
    using rideforge_fare::calculate_demo_fare;
    assert(throws_invalid_argument([] { calculate_demo_fare(0); }));
    assert(throws_invalid_argument([] { calculate_demo_fare(-1); }));
    assert(throws_invalid_argument([] { calculate_demo_fare(std::numeric_limits<int>::max()); }));
}

} // namespace

int main() {
    fare_rounding_and_breakdown();
    invalid_and_overflow_distances();
    std::cout << "Fare calculation tests passed\n";
}

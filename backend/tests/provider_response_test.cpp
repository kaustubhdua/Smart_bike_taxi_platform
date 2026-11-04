#include "../src/provider_response.hpp"

#include <cassert>
#include <iostream>
#include <limits>
#include <string>

int main() {
    std::string body;
    const std::string initial = "provider response";
    assert(rideforge_http::append_bounded_response(
        const_cast<char*>(initial.data()), 1, initial.size(), &body) == initial.size());
    assert(body == initial);

    const std::string fill(rideforge_http::kMaxProviderResponseBytes - body.size(), 'x');
    assert(rideforge_http::append_bounded_response(
        const_cast<char*>(fill.data()), 1, fill.size(), &body) == fill.size());
    assert(body.size() == rideforge_http::kMaxProviderResponseBytes);

    const std::string overflow = "x";
    assert(rideforge_http::append_bounded_response(
        const_cast<char*>(overflow.data()), 1, overflow.size(), &body) == 0);
    assert(body.size() == rideforge_http::kMaxProviderResponseBytes);

    std::string untouched;
    assert(rideforge_http::append_bounded_response(
        nullptr, std::numeric_limits<std::size_t>::max(), 2, &untouched) == 0);
    assert(untouched.empty());
    assert(rideforge_http::append_bounded_response(
        nullptr, 1, 1, nullptr) == 0);

    std::cout << "Bounded provider response tests passed\n";
}

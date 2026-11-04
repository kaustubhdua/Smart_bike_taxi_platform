#pragma once

#include <cstddef>
#include <string>

namespace rideforge_http {

// Geocoding and routing responses are small JSON documents. Refuse oversized
// provider bodies before appending them so a faulty or hostile endpoint cannot
// grow API memory without bound.
inline constexpr std::size_t kMaxProviderResponseBytes = 1024U * 1024U;

inline std::size_t append_bounded_response(char* data, std::size_t size,
                                           std::size_t count, void* target) {
    if (target == nullptr || (size != 0 && count > kMaxProviderResponseBytes / size)) {
        return 0;
    }

    const std::size_t bytes = size * count;
    auto* body = static_cast<std::string*>(target);
    if (body->size() > kMaxProviderResponseBytes ||
        bytes > kMaxProviderResponseBytes - body->size()) {
        return 0;
    }
    if (bytes == 0) return 0;
    if (data == nullptr) return 0;

    body->append(data, bytes);
    return bytes;
}

} // namespace rideforge_http

#pragma once

// Request-abuse controls that must be unit-testable without a database or socket:
//   * trusted-proxy aware client address resolution (for per-IP rate limits);
//   * a bounded per-key failure throttle (for per-account login throttling).

#include <boost/asio/ip/address.hpp>
#include <boost/asio/ip/address_v4.hpp>
#include <boost/asio/ip/address_v6.hpp>
#include <boost/system/error_code.hpp>

#include <algorithm>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace rideforge_guard {

namespace ip = boost::asio::ip;

// Parses an IP literal and folds IPv4-mapped IPv6 (::ffff:a.b.c.d) to IPv4 so one
// client cannot appear as two different rate-limit keys.
inline std::optional<ip::address> parse_address(std::string_view text) {
    boost::system::error_code ec;
    const std::string copy(text);
    ip::address address = ip::make_address(copy, ec);
    if (ec) return std::nullopt;
    if (address.is_v6()) {
        const ip::address_v6 v6 = address.to_v6();
        if (v6.is_v4_mapped()) return ip::address(ip::make_address_v4(ip::v4_mapped, v6));
        // A zone identifier is local to one host and must not split or spoof a key.
        ip::address_v6 stripped = v6;
        stripped.scope_id(0);
        return ip::address(stripped);
    }
    return address;
}

namespace detail {
inline std::string trim(std::string_view value) {
    const auto first = value.find_first_not_of(" \t");
    if (first == std::string_view::npos) return {};
    const auto last = value.find_last_not_of(" \t");
    return std::string(value.substr(first, last - first + 1));
}
} // namespace detail

struct Network {
    ip::address address;
    unsigned prefix{};

    bool contains(const ip::address& candidate) const {
        if (candidate.is_v4() != address.is_v4()) return false;
        if (address.is_v4()) return match(address.to_v4().to_bytes(), candidate.to_v4().to_bytes());
        return match(address.to_v6().to_bytes(), candidate.to_v6().to_bytes());
    }

private:
    template <typename Bytes>
    bool match(const Bytes& network, const Bytes& other) const {
        unsigned remaining = prefix;
        for (std::size_t i = 0; i < network.size() && remaining > 0; ++i) {
            const unsigned bits = std::min(remaining, 8U);
            const auto mask = static_cast<unsigned char>(0xFFU << (8U - bits));
            if ((network[i] & mask) != (other[i] & mask)) return false;
            remaining -= bits;
        }
        return true;
    }
};

// Accepts "10.0.0.0/8", "172.18.0.5" or "fd00::/8". Throws std::invalid_argument on
// anything else so a misconfigured allowlist fails startup instead of silently
// trusting (or distrusting) the wrong peers.
inline Network parse_network(std::string_view text) {
    const std::string entry = detail::trim(text);
    const auto slash = entry.find('/');
    const std::string address_text = entry.substr(0, slash);
    const auto address = parse_address(address_text);
    if (!address) throw std::invalid_argument("invalid trusted proxy address");
    const unsigned max_prefix = address->is_v4() ? 32U : 128U;
    unsigned prefix = max_prefix;
    if (slash != std::string::npos) {
        const std::string prefix_text = entry.substr(slash + 1);
        if (prefix_text.empty() || prefix_text.size() > 3 ||
            prefix_text.find_first_not_of("0123456789") != std::string::npos) {
            throw std::invalid_argument("invalid trusted proxy prefix");
        }
        prefix = static_cast<unsigned>(std::stoul(prefix_text));
        if (prefix > max_prefix) throw std::invalid_argument("invalid trusted proxy prefix");
        // An IPv4-mapped IPv6 network would be folded to IPv4 above, which would
        // change its prefix length; require the operator to write it as IPv4.
        if (address_text.find(':') != std::string::npos && address->is_v4()) {
            throw std::invalid_argument("write IPv4-mapped proxy networks as IPv4");
        }
    }
    return {*address, prefix};
}

class TrustedProxies {
public:
    TrustedProxies() = default;

    static TrustedProxies parse(std::string_view csv) {
        TrustedProxies result;
        std::size_t start = 0;
        while (start <= csv.size()) {
            const auto comma = csv.find(',', start);
            const std::string_view piece = csv.substr(
                start, comma == std::string_view::npos ? std::string_view::npos : comma - start);
            if (!detail::trim(piece).empty()) result.networks_.push_back(parse_network(piece));
            if (comma == std::string_view::npos) break;
            start = comma + 1;
        }
        if (result.networks_.size() > 64) throw std::invalid_argument("too many trusted proxies");
        return result;
    }

    bool empty() const { return networks_.empty(); }

    bool trusts(const ip::address& candidate) const {
        return std::any_of(networks_.begin(), networks_.end(),
            [&](const Network& network) { return network.contains(candidate); });
    }

private:
    std::vector<Network> networks_;
};

// Returns the address that per-IP limits should be keyed on.
//
// X-Forwarded-For is attacker-controlled unless it was appended by a proxy we
// trust, so it is consulted only when the TCP peer itself is a trusted proxy. The
// header is then read right to left, skipping trusted hops; the first untrusted
// address is the client. Any unparsable entry stops the walk at the nearest hop
// we can vouch for, which means a spoofed header can only move the key to an
// address the attacker's own proxy chain already vouched for.
inline std::string resolve_client_ip(std::string_view peer, std::string_view forwarded_for,
                                     const TrustedProxies& trusted) {
    const auto peer_address = parse_address(peer);
    if (!peer_address) return "unknown";
    if (trusted.empty() || !trusted.trusts(*peer_address) || forwarded_for.empty() ||
        forwarded_for.size() > 1024) {
        return peer_address->to_string();
    }

    // The header is already capped at 1 KiB, so reading every entry is bounded. Do
    // not truncate from the left: the rightmost entries are the ones our own proxies
    // appended and are the only ones that can be vouched for.
    std::vector<std::string> entries;
    std::size_t start = 0;
    while (start <= forwarded_for.size()) {
        const auto comma = forwarded_for.find(',', start);
        entries.push_back(detail::trim(forwarded_for.substr(
            start, comma == std::string_view::npos ? std::string_view::npos : comma - start)));
        if (comma == std::string_view::npos) break;
        start = comma + 1;
    }

    ip::address candidate = *peer_address;
    for (auto it = entries.rbegin(); it != entries.rend(); ++it) {
        const auto hop = parse_address(*it);
        if (!hop) return candidate.to_string();
        if (trusted.trusts(*hop)) {
            candidate = *hop;
            continue;
        }
        return hop->to_string();
    }
    return candidate.to_string();
}

// Collapses an address to the unit a single customer realistically controls. An
// IPv6 subscriber is normally delegated a whole /64 (2^64 addresses), so keying a
// limiter on the full address lets one host evade it by rotating addresses.
// IPv4 and the literal "unknown" are returned unchanged.
inline std::string limiter_key(std::string_view client_address) {
    const auto parsed = parse_address(client_address);
    if (!parsed) return std::string(client_address);
    // Use the normalised form so "::ffff:1.2.3.4" and "1.2.3.4" share one key.
    if (!parsed->is_v6()) return parsed->to_string();
    auto bytes = parsed->to_v6().to_bytes();
    for (std::size_t i = 8; i < bytes.size(); ++i) bytes[i] = 0;
    return ip::address_v6(bytes).to_string() + "/64";
}

// Per-key fixed-window request limiter with a hard memory ceiling. New keys are
// rejected when the table is full of live windows; expired keys are reclaimed
// before rejecting. This intentionally fails closed rather than allowing an
// attacker to grow memory by sending requests from unbounded source addresses.
class RateLimiter {
public:
    using clock = std::chrono::steady_clock;

    explicit RateLimiter(unsigned limit, std::size_t max_keys = 10000,
                         std::chrono::seconds window = std::chrono::minutes(1))
        : limit_(limit), max_keys_(max_keys), window_(window) {}

    bool allow(const std::string& key, clock::time_point now = clock::now()) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto found = entries_.find(key);
        if (found != entries_.end() && now - found->second.window_start >= window_) {
            entries_.erase(found);
            found = entries_.end();
        }
        if (found == entries_.end()) {
            if (entries_.size() >= max_keys_) evict_expired(now);
            if (entries_.size() >= max_keys_) return false;
            found = entries_.emplace(key, Entry{now, 0}).first;
        }
        if (++found->second.count > limit_) return false;
        return true;
    }

    std::size_t size() {
        std::lock_guard<std::mutex> lock(mutex_);
        return entries_.size();
    }

private:
    struct Entry {
        clock::time_point window_start;
        unsigned count{};
    };

    void evict_expired(clock::time_point now) {
        for (auto it = entries_.begin(); it != entries_.end();) {
            if (now - it->second.window_start >= window_) it = entries_.erase(it);
            else ++it;
        }
    }

    std::mutex mutex_;
    std::map<std::string, Entry> entries_;
    unsigned limit_;
    std::size_t max_keys_;
    std::chrono::seconds window_;
};

// Counts failures per key inside a fixed window. Unlike a per-request limiter it
// is charged only for failed attempts, so a legitimate user is not penalised for
// signing in repeatedly, while guessing against one account is capped regardless
// of how many source addresses the guesses come from. The key space is bounded so
// an attacker spraying random keys cannot grow memory without limit.
class FailureThrottle {
public:
    using clock = std::chrono::steady_clock;

    FailureThrottle(unsigned max_failures, std::chrono::seconds window, std::size_t max_keys = 10000)
        : max_failures_(max_failures), window_(window), max_keys_(max_keys) {}

    bool blocked(const std::string& key, clock::time_point now = clock::now()) {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto found = entries_.find(key);
        if (found == entries_.end()) return false;
        if (now - found->second.window_start >= window_) {
            entries_.erase(found);
            return false;
        }
        return found->second.failures >= max_failures_;
    }

    void record_failure(const std::string& key, clock::time_point now = clock::now()) {
        std::lock_guard<std::mutex> lock(mutex_);
        auto found = entries_.find(key);
        if (found != entries_.end() && now - found->second.window_start >= window_) {
            entries_.erase(found);
            found = entries_.end();
        }
        if (found == entries_.end()) {
            if (entries_.size() >= max_keys_) evict(now);
            found = entries_.emplace(key, Entry{now, 0}).first;
        }
        if (found->second.failures < max_failures_) ++found->second.failures;
    }

    void reset(const std::string& key) {
        std::lock_guard<std::mutex> lock(mutex_);
        entries_.erase(key);
    }

    std::size_t size() {
        std::lock_guard<std::mutex> lock(mutex_);
        return entries_.size();
    }

private:
    struct Entry {
        clock::time_point window_start;
        unsigned failures{};
    };

    void evict(clock::time_point now) {
        for (auto it = entries_.begin(); it != entries_.end();) {
            if (now - it->second.window_start >= window_) it = entries_.erase(it);
            else ++it;
        }
        if (entries_.size() < max_keys_) return;
        // Still full of live entries: drop the oldest window so memory stays bounded.
        const auto oldest = std::min_element(entries_.begin(), entries_.end(),
            [](const auto& a, const auto& b) { return a.second.window_start < b.second.window_start; });
        if (oldest != entries_.end()) entries_.erase(oldest);
    }

    std::mutex mutex_;
    std::map<std::string, Entry> entries_;
    unsigned max_failures_;
    std::chrono::seconds window_;
    std::size_t max_keys_;
};

} // namespace rideforge_guard

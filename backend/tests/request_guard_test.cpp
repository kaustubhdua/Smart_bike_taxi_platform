#include "../src/request_guard.hpp"

#include <cassert>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <string>

using rideforge_guard::FailureThrottle;
using rideforge_guard::RateLimiter;
using rideforge_guard::TrustedProxies;
using rideforge_guard::parse_address;
using rideforge_guard::parse_network;
using rideforge_guard::resolve_client_ip;

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

void address_parsing() {
    assert(parse_address("203.0.113.9")->to_string() == "203.0.113.9");
    assert(parse_address("2001:db8::1")->to_string() == "2001:db8::1");
    // IPv4-mapped IPv6 must fold to IPv4 so one client cannot own two limiter keys.
    assert(parse_address("::ffff:203.0.113.9")->to_string() == "203.0.113.9");
    assert(parse_address("fe80::1%eth0")->to_string() == "fe80::1");
    assert(!parse_address("not-an-ip"));
    assert(!parse_address(""));
    assert(!parse_address("999.1.1.1"));
    assert(!parse_address("1.2.3"));
}

void network_matching() {
    assert(parse_network("10.0.0.0/8").contains(*parse_address("10.255.255.255")));
    assert(!parse_network("10.0.0.0/8").contains(*parse_address("11.0.0.1")));
    // Prefixes that are not byte aligned must compare individual bits.
    assert(parse_network("10.0.0.0/9").contains(*parse_address("10.127.0.1")));
    assert(!parse_network("10.0.0.0/9").contains(*parse_address("10.128.0.1")));
    assert(parse_network("172.18.0.5").contains(*parse_address("172.18.0.5")));
    assert(!parse_network("172.18.0.5").contains(*parse_address("172.18.0.6")));
    assert(parse_network("0.0.0.0/0").contains(*parse_address("198.51.100.1")));
    assert(parse_network("fd00::/8").contains(*parse_address("fd12:3456::1")));
    assert(!parse_network("fd00::/8").contains(*parse_address("fe80::1")));
    // An IPv4 network never matches an IPv6 address, and vice versa.
    assert(!parse_network("0.0.0.0/0").contains(*parse_address("2001:db8::1")));
    assert(!parse_network("::/0").contains(*parse_address("10.0.0.1")));

    assert(throws_invalid_argument([] { parse_network("nonsense"); }));
    assert(throws_invalid_argument([] { parse_network("10.0.0.0/33"); }));
    assert(throws_invalid_argument([] { parse_network("::1/129"); }));
    assert(throws_invalid_argument([] { parse_network("10.0.0.0/"); }));
    assert(throws_invalid_argument([] { parse_network("10.0.0.0/abc"); }));
    assert(throws_invalid_argument([] { parse_network("10.0.0.0/-1"); }));
    assert(throws_invalid_argument([] { parse_network("::ffff:10.0.0.0/104"); }));
}

void proxy_list_parsing() {
    assert(TrustedProxies::parse("").empty());
    assert(TrustedProxies::parse(" , ,").empty());
    const auto proxies = TrustedProxies::parse(" 10.0.0.0/8 , 172.16.0.0/12,,fd00::/8 ");
    assert(!proxies.empty());
    assert(proxies.trusts(*parse_address("172.31.255.1")));
    assert(proxies.trusts(*parse_address("fd00::7")));
    assert(!proxies.trusts(*parse_address("172.32.0.1")));
    assert(throws_invalid_argument([] { TrustedProxies::parse("10.0.0.0/8,bogus"); }));
    // A typo must fail startup rather than silently trust nobody (or everybody).
    assert(throws_invalid_argument([] { TrustedProxies::parse("10.0.0.0/8;172.16.0.0/12"); }));
}

void client_resolution() {
    const auto proxies = TrustedProxies::parse("10.0.0.0/8");
    const TrustedProxies none;

    // No trusted proxies configured: the header is never consulted.
    assert(resolve_client_ip("203.0.113.9", "1.2.3.4", none) == "203.0.113.9");
    // An untrusted peer cannot choose its own rate-limit key.
    assert(resolve_client_ip("203.0.113.9", "1.2.3.4", proxies) == "203.0.113.9");
    // A trusted proxy reports the real client.
    assert(resolve_client_ip("10.0.0.2", "198.51.100.7", proxies) == "198.51.100.7");
    // A client-supplied prefix cannot override the entry our proxy appended.
    assert(resolve_client_ip("10.0.0.2", "6.6.6.6, 198.51.100.7", proxies) == "198.51.100.7");
    // Trusted hops in the chain are skipped.
    assert(resolve_client_ip("10.0.0.2", "198.51.100.7, 10.0.0.9", proxies) == "198.51.100.7");
    assert(resolve_client_ip("10.0.0.2", "6.6.6.6, 198.51.100.7, 10.0.0.9", proxies) == "198.51.100.7");
    // Every hop trusted: fall back to the furthest trusted hop.
    assert(resolve_client_ip("10.0.0.2", "10.0.0.9, 10.0.0.8", proxies) == "10.0.0.9");
    // Unparsable entries stop the walk at the last hop we can vouch for.
    assert(resolve_client_ip("10.0.0.2", "garbage, 10.0.0.9", proxies) == "10.0.0.9");
    assert(resolve_client_ip("10.0.0.2", "198.51.100.7, garbage", proxies) == "10.0.0.2");
    // Missing or oversized headers fall back to the peer.
    assert(resolve_client_ip("10.0.0.2", "", proxies) == "10.0.0.2");
    assert(resolve_client_ip("10.0.0.2", std::string(2000, '1'), proxies) == "10.0.0.2");
    // IPv4-mapped peers match IPv4 allowlists; IPv6 clients are preserved.
    assert(resolve_client_ip("::ffff:10.0.0.2", "198.51.100.7", proxies) == "198.51.100.7");
    assert(resolve_client_ip("10.0.0.2", "2001:db8::1", proxies) == "2001:db8::1");
    assert(resolve_client_ip("not-an-ip", "1.2.3.4", proxies) == "unknown");

    // Rightmost entries win even when an attacker pads the header with many hops.
    std::string padded;
    for (int i = 0; i < 100; ++i) padded += "6.6.6.6, ";
    padded += "198.51.100.7";
    assert(resolve_client_ip("10.0.0.2", padded, proxies) == "198.51.100.7");
}

void limiter_keys() {
    using rideforge_guard::limiter_key;
    assert(limiter_key("203.0.113.9") == "203.0.113.9");
    assert(limiter_key("unknown") == "unknown");
    // Two hosts in one /64 share a key, so rotating addresses cannot evade a limit.
    assert(limiter_key("2001:db8:1:2:aaaa:bbbb:cccc:dddd") == limiter_key("2001:db8:1:2::1"));
    assert(limiter_key("2001:db8:1:2::1") == "2001:db8:1:2::/64");
    // A different /64 is a different customer.
    assert(limiter_key("2001:db8:1:3::1") != limiter_key("2001:db8:1:2::1"));
    // IPv4-mapped addresses are IPv4 and must not be widened.
    assert(limiter_key("::ffff:203.0.113.9") == "203.0.113.9");
}

void request_rate_limiter() {
    using clock = RateLimiter::clock;
    const auto t0 = clock::now();

    RateLimiter limiter(2, 2, std::chrono::seconds(60));
    assert(limiter.allow("client-a", t0));
    assert(limiter.allow("client-a", t0 + std::chrono::seconds(1)));
    assert(!limiter.allow("client-a", t0 + std::chrono::seconds(2)));
    assert(limiter.allow("client-b", t0 + std::chrono::seconds(2)));
    // The table is full of live keys; a new source is rejected instead of
    // growing memory without bound.
    assert(!limiter.allow("client-c", t0 + std::chrono::seconds(3)));
    assert(limiter.size() == 2);

    // Expired windows are reclaimed at capacity and a new source can proceed.
    assert(limiter.allow("client-c", t0 + std::chrono::seconds(61)));
    assert(limiter.size() <= 2);
    // Existing client keys reset their fixed window after expiry.
    assert(limiter.allow("client-a", t0 + std::chrono::seconds(62)));
    assert(limiter.allow("client-a", t0 + std::chrono::seconds(63)));
    assert(!limiter.allow("client-a", t0 + std::chrono::seconds(64)));
}

void failure_throttle() {
    using clock = FailureThrottle::clock;
    const auto t0 = clock::now();
    FailureThrottle throttle(3, std::chrono::seconds(60));

    assert(!throttle.blocked("a@example.test", t0));
    throttle.record_failure("a@example.test", t0);
    throttle.record_failure("a@example.test", t0 + std::chrono::seconds(1));
    assert(!throttle.blocked("a@example.test", t0 + std::chrono::seconds(2)));
    throttle.record_failure("a@example.test", t0 + std::chrono::seconds(3));
    assert(throttle.blocked("a@example.test", t0 + std::chrono::seconds(4)));
    // Keys are independent.
    assert(!throttle.blocked("b@example.test", t0 + std::chrono::seconds(4)));
    // More failures while blocked do not extend the fixed window.
    throttle.record_failure("a@example.test", t0 + std::chrono::seconds(30));
    assert(throttle.blocked("a@example.test", t0 + std::chrono::seconds(59)));
    assert(!throttle.blocked("a@example.test", t0 + std::chrono::seconds(60)));
    // After expiry a new failure starts a fresh window.
    throttle.record_failure("a@example.test", t0 + std::chrono::seconds(61));
    assert(!throttle.blocked("a@example.test", t0 + std::chrono::seconds(62)));

    // A successful sign-in clears the counter.
    FailureThrottle resettable(2, std::chrono::seconds(60));
    resettable.record_failure("c", t0);
    resettable.record_failure("c", t0);
    assert(resettable.blocked("c", t0));
    resettable.reset("c");
    assert(!resettable.blocked("c", t0));

    // The key space is bounded and eviction prefers expired, then oldest, windows.
    FailureThrottle bounded(1, std::chrono::seconds(60), 4);
    for (int i = 0; i < 10; ++i) {
        bounded.record_failure("k" + std::to_string(i), t0 + std::chrono::seconds(i));
        assert(bounded.size() <= 4);
    }
    assert(bounded.blocked("k9", t0 + std::chrono::seconds(10)));
    assert(!bounded.blocked("k0", t0 + std::chrono::seconds(10)));
}

} // namespace

int main() {
    address_parsing();
    network_matching();
    proxy_list_parsing();
    client_resolution();
    limiter_keys();
    request_rate_limiter();
    failure_throttle();
    std::cout << "Request guard tests passed\n";
}

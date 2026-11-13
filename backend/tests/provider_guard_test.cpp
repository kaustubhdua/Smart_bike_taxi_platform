#include "../src/provider_guard.hpp"

#include <atomic>
#include <cassert>
#include <chrono>
#include <cmath>
#include <iostream>
#include <limits>
#include <string>
#include <thread>
#include <vector>

using namespace rideforge_provider;

namespace {

using clock_type = CircuitBreaker::clock;

void breaker_state_machine() {
    const auto t0 = clock_type::now();
    CircuitBreaker breaker(5, std::chrono::seconds(15));

    // Four failures stay below the threshold and keep the breaker closed.
    for (int i = 0; i < 4; ++i) {
        assert(breaker.allow(t0));
        breaker.record_failure(t0);
    }
    assert(breaker.allow(t0));
    // A success resets the streak, so failures must be consecutive to trip it.
    breaker.record_success();
    for (int i = 0; i < 4; ++i) breaker.record_failure(t0);
    assert(breaker.allow(t0));

    // The fifth consecutive failure opens it and calls fail fast.
    breaker.record_failure(t0);
    assert(breaker.is_open(t0));
    assert(!breaker.allow(t0 + std::chrono::seconds(1)));
    assert(!breaker.allow(t0 + std::chrono::seconds(14)));

    // After the interval exactly one probe is admitted.
    const auto later = t0 + std::chrono::seconds(15);
    assert(breaker.allow(later));
    assert(!breaker.allow(later));
    assert(!breaker.allow(later + std::chrono::seconds(1)));

    // A failed probe re-opens for another full interval.
    breaker.record_failure(later);
    assert(!breaker.allow(later + std::chrono::seconds(14)));
    assert(breaker.allow(later + std::chrono::seconds(15)));

    // A successful probe closes the breaker for everyone.
    breaker.record_success();
    assert(!breaker.is_open(later + std::chrono::seconds(15)));
    assert(breaker.allow(later + std::chrono::seconds(15)));
    assert(breaker.allow(later + std::chrono::seconds(15)));

    // A probe slot granted but never used must be released, or the breaker would
    // stay half-open forever.
    CircuitBreaker stuck(1, std::chrono::seconds(10));
    stuck.record_failure(t0);
    const auto probe_time = t0 + std::chrono::seconds(10);
    assert(stuck.allow(probe_time));
    assert(!stuck.allow(probe_time));
    stuck.cancel_probe();
    assert(stuck.allow(probe_time));
}

void limiter_bounds_in_flight() {
    ConcurrencyLimiter limiter(2);
    auto first = limiter.try_acquire();
    auto second = limiter.try_acquire();
    assert(first && second);
    assert(limiter.in_flight() == 2);
    assert(!limiter.try_acquire());
    {
        auto moved = std::move(first);
        assert(!first);
        assert(moved);
        assert(limiter.in_flight() == 2);
    }
    // Destroying a permit frees exactly one slot.
    assert(limiter.in_flight() == 1);
    auto third = limiter.try_acquire();
    assert(third);
    assert(!limiter.try_acquire());

    // Under contention the bound must hold at every instant.
    ConcurrencyLimiter shared(3);
    std::atomic<int> concurrent{0};
    std::atomic<int> peak{0};
    std::atomic<bool> violated{false};
    std::vector<std::thread> threads;
    for (int t = 0; t < 8; ++t) {
        threads.emplace_back([&] {
            for (int i = 0; i < 2000; ++i) {
                auto permit = shared.try_acquire();
                if (!permit) continue;
                const int now = ++concurrent;
                int seen = peak.load();
                while (now > seen && !peak.compare_exchange_weak(seen, now)) {}
                if (now > 3) violated = true;
                --concurrent;
            }
        });
    }
    for (auto& thread : threads) thread.join();
    assert(!violated.load());
    assert(peak.load() <= 3);
    assert(shared.in_flight() == 0);
}

void failure_classification() {
    assert(counts_as_provider_failure(false, 0));
    assert(counts_as_provider_failure(true, 429));
    assert(counts_as_provider_failure(true, 500));
    assert(counts_as_provider_failure(true, 503));
    // A 4xx caused by our own request says nothing about provider health.
    assert(!counts_as_provider_failure(true, 400));
    assert(!counts_as_provider_failure(true, 404));
    assert(!counts_as_provider_failure(true, 200));
}

void content_types() {
    assert(is_json_content_type("application/json"));
    assert(is_json_content_type("application/json; charset=utf-8"));
    assert(is_json_content_type("  Application/JSON  "));
    assert(is_json_content_type("application/geo+json"));
    assert(is_json_content_type("application/vnd.api+json; charset=utf-8"));
    assert(!is_json_content_type("text/html"));
    assert(!is_json_content_type("text/html; charset=utf-8"));
    assert(!is_json_content_type("text/json"));
    assert(!is_json_content_type("application/jsonp"));
    assert(!is_json_content_type("application/+json"));
    assert(!is_json_content_type("application/xml"));
    assert(!is_json_content_type(""));
    assert(!is_json_content_type("   "));
}

void route_metrics() {
    const auto ok = validate_route_metrics(2500.2, 600.1);
    assert(ok && ok->meters == 2501 && ok->seconds == 601);
    // Exact integers must not be rounded up.
    const auto exact = validate_route_metrics(2500.0, 600.0);
    assert(exact && exact->meters == 2500 && exact->seconds == 600);
    assert(validate_route_metrics(kMaxRouteMeters, kMaxRouteSeconds));
    assert(!validate_route_metrics(kMaxRouteMeters + 0.5, 600.0));
    assert(!validate_route_metrics(2500.0, kMaxRouteSeconds + 0.5));
    // A provider reporting a 2-million-kilometre route must not become a fare.
    assert(!validate_route_metrics(2147483647.0, 600.0));
    assert(!validate_route_metrics(0.0, 600.0));
    assert(!validate_route_metrics(-1.0, 600.0));
    assert(!validate_route_metrics(2500.0, 0.0));
    assert(!validate_route_metrics(2500.0, -5.0));
    assert(!validate_route_metrics(std::nan(""), 600.0));
    assert(!validate_route_metrics(2500.0, std::nan("")));
    assert(!validate_route_metrics(std::numeric_limits<double>::infinity(), 600.0));
    assert(!validate_route_metrics(2500.0, std::numeric_limits<double>::infinity()));
}

void utf8_truncation() {
    assert(truncate_utf8("short", 240) == "short");
    assert(truncate_utf8(std::string(240, 'a'), 240).size() == 240);
    assert(truncate_utf8(std::string(300, 'a'), 240).size() == 240);

    // "é" is two bytes (C3 A9). A byte cut at 240 would leave a dangling lead byte
    // that PostgreSQL rejects as invalid UTF-8.
    const std::string two_byte = std::string(239, 'a') + "\xC3\xA9";
    const auto cut_two = truncate_utf8(two_byte, 240);
    assert(cut_two == std::string(239, 'a'));

    // A four-byte emoji straddling the limit is dropped whole.
    const std::string emoji = std::string(238, 'a') + "\xF0\x9F\x9A\xB2";
    assert(truncate_utf8(emoji, 240) == std::string(238, 'a'));
    // ...but is kept when it fits entirely.
    assert(truncate_utf8(emoji, 242) == emoji);
    assert(truncate_utf8("\xC3\xA9\xC3\xA9", 3) == "\xC3\xA9");
    assert(truncate_utf8("abc", 0).empty());
}

void label_sanitising() {
    assert(sanitize_label("  Noida Sector 18  ", 240) == "Noida Sector 18");
    // NUL would silently truncate a C-string parameter; control characters become spaces.
    assert(sanitize_label(std::string("Sector\0 18", 10), 240) == "Sector  18");
    assert(sanitize_label("line one\nline two\ttab", 240) == "line one line two tab");
    assert(sanitize_label("\x01\x02\x7F", 240).empty());
    assert(sanitize_label("   ", 240).empty());
    assert(sanitize_label(std::string(300, 'x'), 240).size() == 240);
    const auto unicode = sanitize_label(std::string(239, 'a') + "\xC3\xA9", 240);
    assert(unicode == std::string(239, 'a'));
}

void pacing_gate_spaces_calls_and_sheds_excess() {
    using ms = std::chrono::milliseconds;
    const auto t0 = PacingGate::clock::now();

    PacingGate disabled;  // interval 0: never waits, never sheds
    for (int i = 0; i < 100; ++i) assert(disabled.reserve(t0) == ms(0));

    PacingGate gate;
    gate.configure(ms(1000), ms(3000));
    // Four callers arriving together get consecutive one-second slots...
    assert(gate.reserve(t0) == ms(0));
    assert(gate.reserve(t0) == ms(1000));
    assert(gate.reserve(t0) == ms(2000));
    assert(gate.reserve(t0) == ms(3000));
    // ...and the fifth would wait 4 s, which exceeds the bound, so it is shed.
    assert(!gate.reserve(t0).has_value());
    // A shed caller must not consume a slot: once time has passed the queue drains.
    assert(gate.reserve(t0 + ms(1500)) == ms(2500));
    assert(gate.reserve(t0 + std::chrono::seconds(20)) == ms(0));
    // An idle gate does not bank credit: after a long pause the spacing still applies.
    assert(gate.reserve(t0 + std::chrono::seconds(20)) == ms(1000));
}

void pacing_gate_is_thread_safe() {
    using ms = std::chrono::milliseconds;
    PacingGate gate;
    gate.configure(ms(10), ms(1000000));
    const auto t0 = PacingGate::clock::now();
    std::vector<std::thread> threads;
    std::atomic<long long> total_wait_ms{0};
    for (int t = 0; t < 8; ++t) {
        threads.emplace_back([&] {
            for (int i = 0; i < 100; ++i) total_wait_ms += gate.reserve(t0)->count();
        });
    }
    for (auto& thread : threads) thread.join();
    // 800 simultaneous reservations take slots 0, 10, ..., 7990 ms exactly once each.
    assert(total_wait_ms == 10LL * (799LL * 800LL / 2LL));
}

void ttl_cache_expires_and_is_bounded() {
    using ms = std::chrono::milliseconds;
    TtlCache<int> cache(2, ms(25));
    const auto t0 = TtlCache<int>::Clock::now();
    cache.put("first", 1, t0);
    cache.put("second", 2, t0 + ms(5));
    assert(cache.get("first", t0 + ms(1)).value() == 1);
    cache.put("third", 3, t0 + ms(10));
    assert(!cache.get("first", t0 + ms(11)).has_value());
    assert(cache.get("second", t0 + ms(11)).value() == 2);
    assert(cache.get("third", t0 + ms(11)).value() == 3);
    assert(!cache.get("second", t0 + ms(31)).has_value());
    assert(!cache.get("third", t0 + ms(36)).has_value());
}
void pacing_configuration() {
    using ms = std::chrono::milliseconds;
    assert(default_pacing_for("https://nominatim.openstreetmap.org/search") == ms(1000));
    assert(default_pacing_for("https://router.project-osrm.org/route/v1/driving") == ms(1000));
    assert(default_pacing_for("https://routing.openstreetmap.de/routed-car/route/v1/driving") == ms(1000));
    assert(default_pacing_for("http://127.0.0.1:8090/search") == ms(0));
    assert(default_pacing_for("https://geocoder.example.com/search") == ms(0));

    assert(parse_pacing_interval("", ms(1000)) == ms(1000));
    assert(parse_pacing_interval("0", ms(1000)) == ms(0));
    assert(parse_pacing_interval("250", ms(1000)) == ms(250));
    assert(parse_pacing_interval("60000", ms(0)) == ms(60000));
    for (const char* bad : {"60001", "-1", "1.5", "1e3", " 5", "5 ", "abc", "999999", "+5", "0x10"}) {
        bool rejected = false;
        try { (void)parse_pacing_interval(bad, ms(0)); } catch (const std::invalid_argument&) { rejected = true; }
        assert(rejected);
    }
}

} // namespace

int main() {
    pacing_gate_spaces_calls_and_sheds_excess();
    pacing_gate_is_thread_safe();
    pacing_configuration();
    ttl_cache_expires_and_is_bounded();
    breaker_state_machine();
    limiter_bounds_in_flight();
    failure_classification();
    content_types();
    route_metrics();
    utf8_truncation();
    label_sanitising();
    std::cout << "Provider guard tests passed\n";
}

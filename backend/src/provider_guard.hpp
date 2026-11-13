#pragma once

// Protection for calls to third-party geocoding/routing providers. The public
// Nominatim/OSRM demo servers are best-effort; when a provider is slow or down the
// API must fail fast instead of tying up one thread per request for the full
// timeout, and must not hammer a provider that is already rate limiting it.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>

namespace rideforge_provider {

// Thrown when a call is refused locally (breaker open or provider saturated)
// before any request is sent.
class ProviderDegraded : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

// Opens after `failure_threshold` consecutive failures, rejects calls for
// `open_for`, then lets exactly one probe through (half-open). A successful probe
// closes the breaker; a failed one re-opens it for another full interval.
class CircuitBreaker {
public:
    using clock = std::chrono::steady_clock;

    CircuitBreaker(unsigned failure_threshold, std::chrono::seconds open_for)
        : threshold_(failure_threshold), open_for_(open_for) {}

    bool allow(clock::time_point now = clock::now()) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (failures_ < threshold_) return true;
        if (now < open_until_) return false;
        if (probe_in_flight_) return false;
        probe_in_flight_ = true;
        return true;
    }

    void record_success() {
        std::lock_guard<std::mutex> lock(mutex_);
        failures_ = 0;
        probe_in_flight_ = false;
    }

    void record_failure(clock::time_point now = clock::now()) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (failures_ < threshold_) ++failures_;
        probe_in_flight_ = false;
        if (failures_ >= threshold_) open_until_ = now + open_for_;
    }

    // Releases a half-open probe slot that was granted but never used.
    void cancel_probe() {
        std::lock_guard<std::mutex> lock(mutex_);
        probe_in_flight_ = false;
    }

    bool is_open(clock::time_point now = clock::now()) {
        std::lock_guard<std::mutex> lock(mutex_);
        return failures_ >= threshold_ && now < open_until_;
    }

private:
    std::mutex mutex_;
    unsigned threshold_;
    std::chrono::seconds open_for_;
    unsigned failures_{0};
    clock::time_point open_until_{};
    bool probe_in_flight_{false};
};

// Bounds the number of simultaneous in-flight calls to one provider.
class ConcurrencyLimiter {
public:
    explicit ConcurrencyLimiter(unsigned limit) : limit_(limit) {}

    class Permit {
    public:
        Permit() = default;
        Permit(const Permit&) = delete;
        Permit& operator=(const Permit&) = delete;
        Permit(Permit&& other) noexcept : owner_(other.owner_) { other.owner_ = nullptr; }
        Permit& operator=(Permit&& other) noexcept {
            if (this != &other) {
                release();
                owner_ = other.owner_;
                other.owner_ = nullptr;
            }
            return *this;
        }
        ~Permit() { release(); }
        explicit operator bool() const { return owner_ != nullptr; }

    private:
        friend class ConcurrencyLimiter;
        explicit Permit(ConcurrencyLimiter* owner) : owner_(owner) {}
        void release() {
            if (owner_ != nullptr) owner_->in_flight_.fetch_sub(1, std::memory_order_acq_rel);
            owner_ = nullptr;
        }
        ConcurrencyLimiter* owner_{nullptr};
    };

    Permit try_acquire() {
        unsigned current = in_flight_.load(std::memory_order_acquire);
        while (current < limit_) {
            if (in_flight_.compare_exchange_weak(current, current + 1, std::memory_order_acq_rel)) {
                return Permit(this);
            }
        }
        return Permit();
    }

    unsigned in_flight() const { return in_flight_.load(std::memory_order_acquire); }

private:
    std::atomic<unsigned> in_flight_{0};
    unsigned limit_;
};

// Spaces calls to one provider at least `interval` apart across every thread. The
// public Nominatim service allows one request per second for the whole application,
// not per user, so a per-client limiter cannot keep us inside its policy. A caller is
// told how long to wait before sending; if that wait would exceed `max_wait` it is shed
// instead of queued, which keeps the number of sleeping threads bounded. An interval
// of zero disables pacing. Configure before serving requests.
class PacingGate {
public:
    using clock = std::chrono::steady_clock;

    void configure(std::chrono::milliseconds interval, std::chrono::milliseconds max_wait) {
        std::lock_guard<std::mutex> lock(mutex_);
        interval_ = interval;
        max_wait_ = max_wait;
    }

    std::optional<std::chrono::milliseconds> reserve(clock::time_point now = clock::now()) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (interval_.count() <= 0) return std::chrono::milliseconds(0);
        const auto slot = next_slot_ > now ? next_slot_ : now;
        const auto wait = std::chrono::duration_cast<std::chrono::milliseconds>(slot - now);
        if (wait > max_wait_) return std::nullopt;
        next_slot_ = slot + interval_;
        return wait;
    }

private:
    std::mutex mutex_;
    std::chrono::milliseconds interval_{0};
    std::chrono::milliseconds max_wait_{0};
    clock::time_point next_slot_{};
};

struct ProviderGuard {
    CircuitBreaker breaker{5, std::chrono::seconds(15)};
    ConcurrencyLimiter limiter{8};
    PacingGate pacing;
};

// The public OpenStreetMap geocoder is paced by default; any other URL (a contracted
// or self-hosted provider, a test double) is not, unless configured explicitly.
inline std::chrono::milliseconds default_pacing_for(std::string_view geocoding_url) {
    return geocoding_url.find("nominatim.openstreetmap.org") != std::string_view::npos
        ? std::chrono::milliseconds(1000) : std::chrono::milliseconds(0);
}

// Parses RIDEFORGE_GEOCODING_MIN_INTERVAL_MS: an empty value keeps `fallback`, anything
// else must be plain digits no larger than 60000. Throws so a typo stops start-up
// instead of silently disabling the limit.
inline std::chrono::milliseconds parse_pacing_interval(const std::string& value,
                                                       std::chrono::milliseconds fallback) {
    if (value.empty()) return fallback;
    if (value.size() > 5) throw std::invalid_argument("pacing interval too long");
    long long parsed = 0;
    for (const char ch : value) {
        if (ch < '0' || ch > '9') throw std::invalid_argument("pacing interval must be digits");
        parsed = parsed * 10 + (ch - '0');
    }
    if (parsed > 60000) throw std::invalid_argument("pacing interval too large");
    return std::chrono::milliseconds(parsed);
}

// Failures that say something about the provider's health. A 4xx caused by our own
// request (other than 429) does not.
inline bool counts_as_provider_failure(bool transport_ok, long http_status) {
    return !transport_ok || http_status == 429 || http_status >= 500;
}

// Accepts application/json, application/<x>+json and parameters such as charset.
// A captive-portal or error page served as HTML with status 200 must not be parsed
// as provider data.
inline bool is_json_content_type(std::string_view value) {
    const auto semicolon = value.find(';');
    std::string type(value.substr(0, semicolon));
    const auto first = type.find_first_not_of(" \t");
    if (first == std::string::npos) return false;
    type = type.substr(first, type.find_last_not_of(" \t") - first + 1);
    for (char& ch : type) {
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
    }
    if (type == "application/json") return true;
    constexpr std::string_view prefix = "application/";
    constexpr std::string_view suffix = "+json";
    return type.size() > prefix.size() + suffix.size() &&
           type.compare(0, prefix.size(), prefix) == 0 &&
           type.compare(type.size() - suffix.size(), suffix.size(), suffix) == 0;
}

// Longest route this service will quote. Bike taxis are intra-city; anything
// longer than this is far more likely to be a provider error or a wrong geocode
// than a real trip, and would otherwise produce an absurd fare.
inline constexpr double kMaxRouteMeters = 500000.0;
inline constexpr double kMaxRouteSeconds = 86400.0;

struct RouteMetrics {
    int meters{};
    int seconds{};
};

inline std::optional<RouteMetrics> validate_route_metrics(double meters, double seconds) noexcept {
    // Written so NaN fails every comparison and is rejected.
    if (!(meters > 0.0 && meters <= kMaxRouteMeters && seconds > 0.0 && seconds <= kMaxRouteSeconds)) {
        return std::nullopt;
    }
    auto ceil_to_int = [](double value) {
        const auto truncated = static_cast<long long>(value);
        return static_cast<int>(static_cast<double>(truncated) < value ? truncated + 1 : truncated);
    };
    return RouteMetrics{ceil_to_int(meters), ceil_to_int(seconds)};
}

// Cuts at a UTF-8 code point boundary. A raw byte cut can split a multibyte
// character and PostgreSQL then rejects the whole insert as invalid UTF-8.
inline std::string truncate_utf8(std::string value, std::size_t max_bytes) {
    if (value.size() <= max_bytes) return value;
    std::size_t cut = max_bytes;
    while (cut > 0 && (static_cast<unsigned char>(value[cut]) & 0xC0U) == 0x80U) --cut;
    value.resize(cut);
    return value;
}

// Provider-supplied labels are untrusted text. Control characters (including NUL,
// which would silently truncate a C-string parameter) become spaces.
inline std::string sanitize_label(std::string value, std::size_t max_bytes) {
    for (char& ch : value) {
        const auto byte = static_cast<unsigned char>(ch);
        if (byte < 0x20U || byte == 0x7FU) ch = ' ';
    }
    value = truncate_utf8(std::move(value), max_bytes);
    const auto first = value.find_first_not_of(' ');
    if (first == std::string::npos) return {};
    return value.substr(first, value.find_last_not_of(' ') - first + 1);
}

} // namespace rideforge_provider

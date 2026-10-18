#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <curl/curl.h>
#include <libpq-fe.h>
#include <nlohmann/json.hpp>
#include "security.hpp"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace http = beast::http;
using tcp = asio::ip::tcp;
using json = nlohmann::json;

namespace {

struct Account {
    std::string id;
    std::string role;
    std::string password_hash;
    bool active{};
};

struct Location {
    std::string label;
    double latitude{};
    double longitude{};
};

struct HttpResult {
    long status{};
    std::string body;
};

std::string env_or(const char* key, const char* fallback) {
    const char* value = std::getenv(key);
    return value != nullptr && *value != '\0' ? value : fallback;
}

size_t append_body(char* data, size_t size, size_t count, void* target) {
    const auto bytes = size * count;
    static_cast<std::string*>(target)->append(data, bytes);
    return bytes;
}

HttpResult get_json(const std::string& url) {
    CURL* curl = curl_easy_init();
    if (curl == nullptr) throw std::runtime_error("HTTP client unavailable");
    std::string body;
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, append_body);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 2500L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 6000L);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, env_or("SAARTHI_USER_AGENT", "SaarthiMobilityDemo/0.1 (configure SAARTHI_USER_AGENT)").c_str());
    const CURLcode result = curl_easy_perform(curl);
    long status = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    curl_easy_cleanup(curl);
    if (result != CURLE_OK || status < 200 || status >= 300) {
        throw std::runtime_error("Routing provider unavailable");
    }
    return {status, std::move(body)};
}

std::string url_encode(const std::string& value) {
    CURL* curl = curl_easy_init();
    if (curl == nullptr) throw std::runtime_error("HTTP client unavailable");
    char* encoded = curl_easy_escape(curl, value.c_str(), static_cast<int>(value.size()));
    if (encoded == nullptr) {
        curl_easy_cleanup(curl);
        throw std::runtime_error("Could not encode location");
    }
    std::string result(encoded);
    curl_free(encoded);
    curl_easy_cleanup(curl);
    return result;
}

Location geocode(const std::string& label) {
    const auto response = get_json(
        std::string("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=") +
        url_encode(label));
    const auto parsed = json::parse(response.body);
    if (!parsed.is_array() || parsed.empty() || !parsed.at(0).is_object()) {
        throw std::invalid_argument("Location could not be found");
    }
    const auto& item = parsed.at(0);
    const double latitude = std::stod(item.at("lat").get<std::string>());
    const double longitude = std::stod(item.at("lon").get<std::string>());
    if (!std::isfinite(latitude) || !std::isfinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw std::invalid_argument("Location provider returned invalid coordinates");
    }
    std::string display = item.value("display_name", label);
    if (display.size() > 240) display.resize(240);
    return {std::move(display), latitude, longitude};
}

std::pair<int, int> route(const Location& pickup, const Location& destination) {
    const std::string url =
        "https://router.project-osrm.org/route/v1/driving/" +
        std::to_string(pickup.longitude) + "," + std::to_string(pickup.latitude) + ";" +
        std::to_string(destination.longitude) + "," + std::to_string(destination.latitude) +
        "?overview=false&alternatives=false&steps=false";
    const auto response = get_json(url);
    const auto parsed = json::parse(response.body);
    if (!parsed.is_object() || parsed.value("code", std::string()) != "Ok" ||
        !parsed.contains("routes") || !parsed["routes"].is_array() ||
        parsed["routes"].empty()) {
        throw std::invalid_argument("No drivable route found between these locations");
    }
    const auto& result = parsed["routes"][0];
    const double meters = result.at("distance").get<double>();
    const double seconds = result.at("duration").get<double>();
    if (!std::isfinite(meters) || !std::isfinite(seconds) || meters <= 0 || seconds <= 0 ||
        meters > static_cast<double>(std::numeric_limits<int>::max()) ||
        seconds > static_cast<double>(std::numeric_limits<int>::max())) {
        throw std::invalid_argument("Routing provider returned invalid route metrics");
    }
    return {static_cast<int>(std::ceil(meters)), static_cast<int>(std::ceil(seconds))};
}

class Database {
public:
    explicit Database(const std::string& url) : connection_(PQconnectdb(url.c_str())) {
        if (connection_ == nullptr || PQstatus(connection_) != CONNECTION_OK) {
            std::string error = connection_ == nullptr ? "PostgreSQL allocation failed" : PQerrorMessage(connection_);
            if (connection_ != nullptr) PQfinish(connection_);
            connection_ = nullptr;
            throw std::runtime_error("Database unavailable: " + error);
        }
    }
    ~Database() { if (connection_ != nullptr) PQfinish(connection_); }
    Database(const Database&) = delete;
    Database& operator=(const Database&) = delete;

    std::string create_passenger(const std::string& email, const std::string& name,
                                 const std::string& hash) {
        const char* params[] = {email.c_str(), name.c_str(), hash.c_str()};
        PGresult* result = PQexecParams(connection_,
            "INSERT INTO accounts (email,display_name,role,password_hash) "
            "VALUES ($1,$2,'passenger',$3) RETURNING id::text",
            3, nullptr, params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            const char* state = result == nullptr ? nullptr : PQresultErrorField(result, PG_DIAG_SQLSTATE);
            const bool duplicate = state != nullptr && std::string(state) == "23505";
            if (result != nullptr) PQclear(result);
            if (duplicate) throw std::domain_error("email_exists");
            throw std::runtime_error("Could not create account");
        }
        const std::string id = PQgetvalue(result, 0, 0);
        PQclear(result);
        return id;
    }

    std::optional<Account> find_account(const std::string& email) {
        const char* params[] = {email.c_str()};
        PGresult* result = PQexecParams(connection_,
            "SELECT id::text,role::text,password_hash,is_active FROM accounts WHERE email=$1",
            1, nullptr, params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not query account");
        }
        if (PQntuples(result) == 0) {
            PQclear(result);
            return std::nullopt;
        }
        Account account{PQgetvalue(result, 0, 0), PQgetvalue(result, 0, 1),
                        PQgetvalue(result, 0, 2), std::string(PQgetvalue(result, 0, 3)) == "t"};
        PQclear(result);
        return account;
    }

    std::string save_quote(const Location& pickup, const Location& destination,
                           int distance_m, int duration_seconds, int fare_paise) {
        // Keep parameter strings alive for the complete PQexecParams call.
        const std::vector<std::string> owned = {
            pickup.label, std::to_string(pickup.latitude), std::to_string(pickup.longitude),
            destination.label, std::to_string(destination.latitude), std::to_string(destination.longitude),
            std::to_string(distance_m), std::to_string(duration_seconds), std::to_string(fare_paise)
        };
        std::vector<const char*> params;
        params.reserve(owned.size());
        for (const auto& value : owned) params.push_back(value.c_str());
        PGresult* result = PQexecParams(connection_,
            "INSERT INTO route_quotes (pickup_label,pickup_latitude,pickup_longitude,"
            "destination_label,destination_latitude,destination_longitude,route_distance_m,"
            "route_duration_seconds,fare_paise,currency,expires_at) "
            "VALUES ($1,$2::double precision,$3::double precision,$4,$5::double precision,"
            "$6::double precision,$7::integer,$8::integer,$9::integer,'INR',now()+interval '5 minutes') "
            "RETURNING id::text, to_char(expires_at AT TIME ZONE 'UTC', "
            "'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
            static_cast<int>(params.size()), nullptr, params.data(), nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK || PQntuples(result) != 1) {
            const std::string error = PQerrorMessage(connection_);
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not persist route quote: " + error);
        }
        const std::string quote_id = PQgetvalue(result, 0, 0);
        const std::string expires_at = PQgetvalue(result, 0, 1);
        PQclear(result);
        return json{{"quoteId", quote_id}, {"expiresAt", expires_at}}.dump();
    }

private:
    PGconn* connection_{};
};

class RateLimiter {
public:
    bool allow(const std::string& key) {
        using clock = std::chrono::steady_clock;
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = clock::now();
        auto& bucket = buckets_[key];
        if (now - bucket.window >= std::chrono::minutes(1)) {
            bucket.window = now;
            bucket.count = 0;
        }
        if (++bucket.count > 30) return false;
        if (buckets_.size() > 10000) {
            for (auto it = buckets_.begin(); it != buckets_.end();) {
                if (now - it->second.window >= std::chrono::minutes(2)) it = buckets_.erase(it);
                else ++it;
            }
        }
        return true;
    }
private:
    struct Bucket { std::chrono::steady_clock::time_point window = std::chrono::steady_clock::now(); unsigned count{}; };
    std::mutex mutex_;
    std::map<std::string, Bucket> buckets_;
};

RateLimiter quote_limiter;

http::response<http::string_body> response(http::status status, const json& body,
                                           const http::request<http::string_body>& request) {
    http::response<http::string_body> result{status, request.version()};
    result.set(http::field::server, "Saarthi API");
    result.set(http::field::content_type, "application/json; charset=utf-8");
    result.set(http::field::cache_control, "no-store");
    result.set("X-Content-Type-Options", "nosniff");
    result.set("Referrer-Policy", "no-referrer");
    const auto origin_view = request[http::field::origin];
    const std::string origin(origin_view.data(), origin_view.size());
    const std::string allowed = env_or("SAARTHI_ALLOWED_ORIGIN", "http://localhost:5173");
    if (!origin.empty() && origin == allowed) {
        result.set(http::field::access_control_allow_origin, allowed);
        result.set(http::field::vary, "Origin");
    }
    result.body() = body.dump();
    result.prepare_payload();
    return result;
}

std::string client_ip(const tcp::socket& socket) {
    boost::system::error_code ec;
    const auto address = socket.remote_endpoint(ec).address();
    return ec ? "unknown" : address.to_string();
}

http::response<http::string_body> handle_auth(
    const http::request<http::string_body>& request, const std::string& path) {
    if (request.body().size() > 16384) {
        return response(http::status::payload_too_large, {{"error", "request_too_large"}}, request);
    }
    try {
        const auto body = json::parse(request.body());
        const bool registering = path == "/api/v1/auth/register";
        if (!body.is_object() || !body.contains("email") || !body["email"].is_string() ||
            !body.contains("password") || !body["password"].is_string() ||
            (registering && (!body.contains("displayName") || !body["displayName"].is_string()))) {
            throw std::invalid_argument("email and password are required");
        }
        std::string email = body["email"].get<std::string>();
        const std::string password = body["password"].get<std::string>();
        std::transform(email.begin(), email.end(), email.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        if (email.empty() || email.size() > 254 || password.empty() || password.size() > 128) {
            throw std::invalid_argument("email or password length is invalid");
        }
        Database database(env_or("DATABASE_URL", ""));
        if (registering) {
            std::string name = body["displayName"].get<std::string>();
            const auto at = email.find('@');
            if (at == std::string::npos || at == 0 || email.find('.', at) == std::string::npos ||
                name.empty() || name.size() > 120 || password.size() < 12) {
                throw std::invalid_argument("valid email, displayName, and 12-character password required");
            }
            const std::string hash = saarthi_security::password_hash(password);
            const std::string id = database.create_passenger(email, name, hash);
            const std::string token = saarthi_security::sign_access_token(
                id, "passenger", env_or("SAARTHI_JWT_SECRET", ""));
            return response(http::status::created, {
                {"accessToken", token}, {"tokenType", "Bearer"}, {"expiresIn", 900},
                {"account", {{"id", id}, {"email", email}, {"displayName", name}, {"role", "passenger"}}}
            }, request);
        }
        const auto account = database.find_account(email);
        if (!account || !account->active ||
            !saarthi_security::verify_password(password, account->password_hash)) {
            return response(http::status::unauthorized, {{"error", "invalid_credentials"}}, request);
        }
        const std::string token = saarthi_security::sign_access_token(
            account->id, account->role, env_or("SAARTHI_JWT_SECRET", ""));
        return response(http::status::ok, {
            {"accessToken", token}, {"tokenType", "Bearer"}, {"expiresIn", 900},
            {"account", {{"id", account->id}, {"email", email}, {"role", account->role}}}
        }, request);
    } catch (const std::domain_error&) {
        return response(http::status::conflict, {{"error", "email_already_exists"}}, request);
    } catch (const std::invalid_argument& error) {
        return response(http::status::unprocessable_entity, {{"error", error.what()}}, request);
    } catch (const json::exception&) {
        return response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
    } catch (const std::exception&) {
        return response(http::status::service_unavailable, {{"error", "authentication_unavailable"}}, request);
    }
}

void handle_request(tcp::socket socket) {
    beast::flat_buffer buffer;
    http::request<http::string_body> request;
    boost::system::error_code ec;
    http::read(socket, buffer, request, ec);
    if (ec) return;
    request.body().shrink_to_fit();

    http::response<http::string_body> result;
    const std::string path(request.target().data(), request.target().size());
    if (request.method() == http::verb::post &&
        (path == "/api/v1/auth/register" || path == "/api/v1/auth/login")) {
        result = handle_auth(request, path);
    } else if (request.method() == http::verb::options) {
        result = response(http::status::no_content, json::object(), request);
        result.set(http::field::access_control_allow_methods, "GET, POST, OPTIONS");
        result.set(http::field::access_control_allow_headers, "Content-Type, Authorization, Idempotency-Key");
        result.set(http::field::access_control_max_age, "600");
        result.body().clear();
        result.prepare_payload();
    } else if (request.method() == http::verb::get && path == "/api/v1/health") {
        try {
            Database database(env_or("DATABASE_URL", ""));
            result = response(http::status::ok, {{"status", "ok"}, {"database", "connected"}}, request);
        } catch (const std::exception&) {
            result = response(http::status::service_unavailable,
                              {{"status", "degraded"}, {"database", "unavailable"}}, request);
        }
    } else if (request.method() == http::verb::post && path == "/api/v1/routes/quote") {
        if (!quote_limiter.allow(client_ip(socket))) {
            result = response(http::status::too_many_requests, {{"error", "rate_limited"}}, request);
        } else if (request.body().size() > 16384) {
            result = response(http::status::payload_too_large, {{"error", "request_too_large"}}, request);
        } else {
            try {
                const auto body = json::parse(request.body());
                if (!body.is_object() || !body.contains("pickup") || !body.contains("destination") ||
                    !body["pickup"].is_object() || !body["destination"].is_object() ||
                    !body["pickup"].contains("label") || !body["destination"].contains("label") ||
                    !body["pickup"]["label"].is_string() || !body["destination"]["label"].is_string()) {
                    throw std::invalid_argument("pickup and destination labels are required");
                }
                const std::string pickup_label = body["pickup"]["label"].get<std::string>();
                const std::string destination_label = body["destination"]["label"].get<std::string>();
                if (pickup_label.size() < 2 || pickup_label.size() > 240 ||
                    destination_label.size() < 2 || destination_label.size() > 240 ||
                    pickup_label == destination_label) {
                    throw std::invalid_argument("Provide two different location labels between 2 and 240 characters");
                }
                const Location pickup = geocode(pickup_label);
                const Location destination = geocode(destination_label);
                if (std::abs(pickup.latitude - destination.latitude) < 1e-7 &&
                    std::abs(pickup.longitude - destination.longitude) < 1e-7) {
                    throw std::invalid_argument("Pickup and destination resolve to the same place");
                }
                const auto [distance_m, duration_seconds] = route(pickup, destination);
                // Demo tariff: ₹20 base + ₹11/km, rounded up to the next paise.
                const long long fare = 2000LL +
                    (static_cast<long long>(distance_m) * 1100LL + 999LL) / 1000LL;
                if (fare > std::numeric_limits<int>::max()) {
                    throw std::invalid_argument("Route is too long for a supported quote");
                }
                Database database(env_or("DATABASE_URL", ""));
                const auto saved = json::parse(database.save_quote(
                    pickup, destination, distance_m, duration_seconds, static_cast<int>(fare)));
                result = response(http::status::ok, {
                    {"quoteId", saved.at("quoteId")},
                    {"distanceKm", std::round((distance_m / 1000.0) * 100.0) / 100.0},
                    {"durationMinutes", std::max(1, static_cast<int>(std::ceil(duration_seconds / 60.0)))},
                    {"farePaise", fare},
                    {"currency", "INR"},
                    {"expiresAt", saved.at("expiresAt")}
                }, request);
            } catch (const std::invalid_argument& error) {
                result = response(http::status::unprocessable_entity, {{"error", error.what()}}, request);
            } catch (const json::exception&) {
                result = response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
            } catch (const std::exception& error) {
                std::cerr << "Quote request failed: " << error.what() << '\n';
                result = response(http::status::service_unavailable,
                                  {{"error", "quote_service_unavailable"}}, request);
            }
        }
    } else {
        result = response(http::status::not_found, {{"error", "not_found"}}, request);
    }

    result.keep_alive(request.keep_alive());
    http::write(socket, result, ec);
    socket.shutdown(tcp::socket::shutdown_send, ec);
}

} // namespace

int main() {
    curl_global_init(CURL_GLOBAL_DEFAULT);
    const auto address = asio::ip::make_address(env_or("SAARTHI_BIND_ADDRESS", "0.0.0.0"));
    const unsigned short port = static_cast<unsigned short>(std::stoul(env_or("PORT", "8080")));
    asio::io_context context{1};
    tcp::acceptor acceptor{context, {address, port}};
    std::cout << "Saarthi API listening on " << address.to_string() << ':' << port << '\n';
    for (;;) {
        tcp::socket socket{context};
        acceptor.accept(socket);
        std::thread(handle_request, std::move(socket)).detach();
    }
}

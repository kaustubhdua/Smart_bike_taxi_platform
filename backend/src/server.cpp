#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <curl/curl.h>
#include <libpq-fe.h>
#include <nlohmann/json.hpp>
#include "security.hpp"

#include <algorithm>
#include <array>
#include <openssl/rand.h>
#include <atomic>
#include <csignal>
#include <chrono>
#include <condition_variable>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <deque>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <map>
#include <mutex>
#include <optional>
#include <poll.h>
#include <string>
#include <string_view>
#include <cstdint>
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

int dispatch_radius_meters() {
    const std::string configured = env_or("RIDEFORGE_DISPATCH_RADIUS_KM", "20");
    if (configured.empty() || !std::all_of(configured.begin(), configured.end(),
            [](unsigned char ch) { return std::isdigit(ch) != 0; })) {
        throw std::runtime_error("RIDEFORGE_DISPATCH_RADIUS_KM must be an integer from 1 to 100");
    }
    std::size_t parsed = 0;
    unsigned long kilometers = 0;
    try {
        kilometers = std::stoul(configured, &parsed);
    } catch (...) {
        throw std::runtime_error("RIDEFORGE_DISPATCH_RADIUS_KM must be an integer from 1 to 100");
    }
    if (parsed != configured.size() || kilometers < 1 || kilometers > 100) {
        throw std::runtime_error("RIDEFORGE_DISPATCH_RADIUS_KM must be an integer from 1 to 100");
    }
    return static_cast<int>(kilometers * 1000UL);
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
    curl_easy_setopt(curl, CURLOPT_USERAGENT, env_or("RIDEFORGE_USER_AGENT", "RideForgeMobilityDemo/0.1 (configure RIDEFORGE_USER_AGENT)").c_str());
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
        env_or("RIDEFORGE_GEOCODING_URL", "https://nominatim.openstreetmap.org/search") +
        "?format=jsonv2&limit=1&q=" + url_encode(label));
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
        env_or("RIDEFORGE_ROUTING_URL", "https://router.project-osrm.org/route/v1/driving") + "/" +
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

class DatabasePool {
public:
    static DatabasePool& instance() {
        static DatabasePool pool;
        return pool;
    }

    PGconn* acquire(const std::string& url) {
        const auto deadline = std::chrono::steady_clock::now() + kAcquireTimeout;
        std::unique_lock<std::mutex> lock(mutex_);
        if (has_url_ && url_ != url) {
            throw std::runtime_error("Database URL changed while the process was running");
        }
        if (!has_url_) {
            url_ = url;
            has_url_ = true;
        }

        for (;;) {
            if (!idle_.empty()) {
                PGconn* connection = idle_.front();
                idle_.pop_front();
                if (PQstatus(connection) == CONNECTION_OK &&
                    PQtransactionStatus(connection) == PQTRANS_IDLE) {
                    return connection;
                }
                PQfinish(connection);
                if (total_ > 0) --total_;
                cv_.notify_one();
                continue;
            }

            if (total_ < kMaxConnections) {
                ++total_;
                lock.unlock();
                PGconn* connection = PQconnectdb(url.c_str());
                if (connection != nullptr && PQstatus(connection) == CONNECTION_OK &&
                    PQtransactionStatus(connection) == PQTRANS_IDLE) {
                    return connection;
                }
                const std::string error = connection == nullptr
                    ? "PostgreSQL allocation failed" : PQerrorMessage(connection);
                if (connection != nullptr) PQfinish(connection);
                lock.lock();
                if (total_ > 0) --total_;
                lock.unlock();
                cv_.notify_one();
                throw std::runtime_error("Database unavailable: " + error);
            }

            if (!cv_.wait_until(lock, deadline, [this] {
                    return !idle_.empty() || total_ < kMaxConnections;
                })) {
                throw std::runtime_error("Database connection pool is saturated");
            }
        }
    }

    void release(PGconn* connection) noexcept {
        if (connection == nullptr) return;
        bool reusable = PQstatus(connection) == CONNECTION_OK;
        if (reusable) {
            const auto transaction_status = PQtransactionStatus(connection);
            if (transaction_status == PQTRANS_INTRANS || transaction_status == PQTRANS_INERROR) {
                PGresult* rollback = PQexec(connection, "ROLLBACK");
                reusable = rollback != nullptr && PQresultStatus(rollback) == PGRES_COMMAND_OK;
                if (rollback != nullptr) PQclear(rollback);
            } else if (transaction_status != PQTRANS_IDLE) {
                reusable = false;
            }
        }
        // Reset session-level state before sharing the connection with another request.
        if (reusable) {
            PGresult* reset = PQexec(connection, "DISCARD ALL");
            reusable = reset != nullptr && PQresultStatus(reset) == PGRES_COMMAND_OK;
            if (reset != nullptr) PQclear(reset);
        }
        reusable = reusable && PQstatus(connection) == CONNECTION_OK;
        if (!reusable) PQfinish(connection);

        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (reusable) {
                idle_.push_back(connection);
            } else if (total_ > 0) {
                --total_;
            }
        }
        cv_.notify_one();
    }

    ~DatabasePool() {
        for (PGconn* connection : idle_) {
            if (connection != nullptr) PQfinish(connection);
        }
    }

private:
    static constexpr std::size_t kMaxConnections = 12;
    static constexpr std::chrono::milliseconds kAcquireTimeout{2000};
    std::mutex mutex_;
    std::condition_variable cv_;
    std::deque<PGconn*> idle_;
    std::size_t total_{};
    std::string url_;
    bool has_url_{};
};

class Database {
public:
    explicit Database(const std::string& url) : connection_(DatabasePool::instance().acquire(url)) {}
    bool schema_ready() {
        PGresult* result = PQexec(connection_,
            "SELECT to_regclass('public.accounts') IS NOT NULL,"
            "to_regclass('public.rides') IS NOT NULL,"
            "to_regclass('public.ride_event_outbox') IS NOT NULL,"
            "to_regclass('public.support_reports') IS NOT NULL,"
            "to_regclass('public.driver_ride_declines') IS NOT NULL,"
            "to_regclass('public.ride_offers') IS NOT NULL,"
            "to_regclass('public.schema_migrations') IS NOT NULL,"
            "EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='001_initial_schema'),"
            "EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='002_driver_approval_and_outbox'),"
            "EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='003_outbox_dead_letters'),"
            "EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='004_support_reports'),"
            "EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='005_driver_ride_declines'),"
            "EXISTS (SELECT 1 FROM public.schema_migrations WHERE version='006_durable_driver_offers')");
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK ||
            PQntuples(result) != 1 || PQnfields(result) != 13) {
            if (result != nullptr) PQclear(result);
            return false;
        }
        bool ready = true;
        for (int column = 0; column < 13; ++column) {
            ready = ready && std::string(PQgetvalue(result, 0, column)) == "t";
        }
        PQclear(result);
        return ready;
    }
    ~Database() { if (connection_ != nullptr) DatabasePool::instance().release(connection_); }
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

    std::string create_driver(const std::string& email, const std::string& name,
                              const std::string& hash, const std::string& vehicle_registration,
                              const std::string& admin_id) {
        auto command = [this](const char* sql) {
            PGresult* result = PQexec(connection_, sql);
            if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
                if (result != nullptr) PQclear(result);
                throw std::runtime_error("Database transaction command failed");
            }
            PQclear(result);
        };
        command("BEGIN");
        try {
            const char* account_params[] = {email.c_str(), name.c_str(), hash.c_str()};
            PGresult* account = PQexecParams(connection_,
                "INSERT INTO accounts (email,display_name,role,password_hash) "
                "VALUES ($1,$2,'driver',$3) RETURNING id::text",
                3, nullptr, account_params, nullptr, nullptr, 0);
            if (account == nullptr || PQresultStatus(account) != PGRES_TUPLES_OK ||
                PQntuples(account) != 1) {
                const char* state = account == nullptr ? nullptr : PQresultErrorField(account, PG_DIAG_SQLSTATE);
                const bool duplicate = state != nullptr && std::string(state) == "23505";
                if (account != nullptr) PQclear(account);
                if (duplicate) throw std::domain_error("email_or_vehicle_already_exists");
                throw std::runtime_error("Could not create driver account");
            }
            const std::string driver_id = PQgetvalue(account, 0, 0);
            PQclear(account);
            const char* profile_params[] = {driver_id.c_str(), vehicle_registration.c_str()};
            PGresult* profile = PQexecParams(connection_,
                "INSERT INTO driver_profiles (account_id,vehicle_registration,is_approved,is_online) "
                "VALUES ($1::uuid,$2,false,false)",
                2, nullptr, profile_params, nullptr, nullptr, 0);
            if (profile == nullptr || PQresultStatus(profile) != PGRES_COMMAND_OK) {
                const char* state = profile == nullptr ? nullptr : PQresultErrorField(profile, PG_DIAG_SQLSTATE);
                const bool duplicate = state != nullptr && std::string(state) == "23505";
                if (profile != nullptr) PQclear(profile);
                if (duplicate) throw std::domain_error("email_or_vehicle_already_exists");
                throw std::runtime_error("Could not create driver profile");
            }
            PQclear(profile);
            const char* audit_params[] = {admin_id.c_str(), driver_id.c_str()};
            PGresult* audit = PQexecParams(connection_,
                "INSERT INTO admin_audit_events (actor_id,action,target_type,target_id,details) "
                "VALUES ($1::uuid,'driver.provisioned','driver',$2,'{\"approved\":false}'::jsonb)",
                2, nullptr, audit_params, nullptr, nullptr, 0);
            if (audit == nullptr || PQresultStatus(audit) != PGRES_COMMAND_OK) {
                if (audit != nullptr) PQclear(audit);
                throw std::runtime_error("Could not audit driver provisioning");
            }
            PQclear(audit);
            command("COMMIT");
            return driver_id;
        } catch (...) {
            PGresult* rollback = PQexec(connection_, "ROLLBACK");
            if (rollback != nullptr) PQclear(rollback);
            throw;
        }
    }

    json list_drivers() {
        PGresult* result = PQexec(connection_,
            "SELECT a.id::text,a.email,a.display_name,d.vehicle_registration,d.is_approved,"
            "d.is_online,d.created_at::text FROM driver_profiles d "
            "JOIN accounts a ON a.id=d.account_id ORDER BY d.created_at DESC LIMIT 100");
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not list drivers");
        }
        json drivers = json::array();
        for (int i = 0; i < PQntuples(result); ++i) {
            drivers.push_back({
                {"driverId", PQgetvalue(result, i, 0)},
                {"email", PQgetvalue(result, i, 1)},
                {"displayName", PQgetvalue(result, i, 2)},
                {"vehicleRegistration", PQgetvalue(result, i, 3)},
                {"approved", std::string(PQgetvalue(result, i, 4)) == "t"},
                {"online", std::string(PQgetvalue(result, i, 5)) == "t"},
                {"createdAt", PQgetvalue(result, i, 6)}
            });
        }
        PQclear(result);
        return json{{"drivers", drivers}};
    }

    json set_driver_approval(const std::string& driver_id, const std::string& admin_id,
                             bool approved) {
        auto command = [this](const char* sql) {
            PGresult* result = PQexec(connection_, sql);
            if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
                if (result != nullptr) PQclear(result);
                throw std::runtime_error("Database transaction command failed");
            }
            PQclear(result);
        };
        command("BEGIN");
        try {
            const char* driver_params[] = {driver_id.c_str()};
            PGresult* locked = PQexecParams(connection_,
                "SELECT account_id::text FROM driver_profiles WHERE account_id=$1::uuid FOR UPDATE",
                1, nullptr, driver_params, nullptr, nullptr, 0);
            if (locked == nullptr || PQresultStatus(locked) != PGRES_TUPLES_OK) {
                if (locked != nullptr) PQclear(locked);
                throw std::runtime_error("Could not lock driver profile");
            }
            if (PQntuples(locked) != 1) {
                PQclear(locked);
                throw std::domain_error("driver_not_found");
            }
            PQclear(locked);
            const std::string approved_value = approved ? "true" : "false";
            const char* update_params[] = {driver_id.c_str(), approved_value.c_str(), admin_id.c_str()};
            PGresult* updated = PQexecParams(connection_,
                "UPDATE driver_profiles SET is_approved=$2::boolean,"
                "approved_at=CASE WHEN $2::boolean THEN now() ELSE NULL END,"
                "approved_by=CASE WHEN $2::boolean THEN $3::uuid ELSE NULL END,"
                "is_online=false "
                "WHERE account_id=$1::uuid",
                3, nullptr, update_params, nullptr, nullptr, 0);
            if (updated == nullptr || PQresultStatus(updated) != PGRES_COMMAND_OK ||
                std::string(PQcmdTuples(updated)) != "1") {
                if (updated != nullptr) PQclear(updated);
                throw std::runtime_error("Could not update driver approval");
            }
            PQclear(updated);
            const char* audit_params[] = {admin_id.c_str(), driver_id.c_str(), approved_value.c_str()};
            PGresult* audit = PQexecParams(connection_,
                "INSERT INTO admin_audit_events (actor_id,action,target_type,target_id,details) "
                "VALUES ($1::uuid,CASE WHEN $3::boolean THEN 'driver.approved' ELSE 'driver.suspended' END,"
                "'driver',$2,jsonb_build_object('approved',$3::boolean))",
                3, nullptr, audit_params, nullptr, nullptr, 0);
            if (audit == nullptr || PQresultStatus(audit) != PGRES_COMMAND_OK) {
                if (audit != nullptr) PQclear(audit);
                throw std::runtime_error("Could not audit driver approval");
            }
            PQclear(audit);
            command("COMMIT");
            return json{{"driverId", driver_id}, {"approved", approved},
                        {"online", false}};
        } catch (...) {
            PGresult* rollback = PQexec(connection_, "ROLLBACK");
            if (rollback != nullptr) PQclear(rollback);
            throw;
        }
    }

    json admin_audit_events(int requested_limit) {
        const int limit = std::max(1, std::min(requested_limit, 100));
        const std::string limit_text = std::to_string(limit);
        const char* params[] = {limit_text.c_str()};
        PGresult* result = PQexecParams(connection_,
            "SELECT a.id::text,a.actor_id::text,actor.email,a.action,a.target_type,"
            "a.target_id::text,a.details::text,a.created_at::text "
            "FROM admin_audit_events a JOIN accounts actor ON actor.id=a.actor_id "
            "ORDER BY a.id DESC LIMIT $1::integer",
            1, nullptr, params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not read admin audit events");
        }
        json events = json::array();
        for (int row = 0; row < PQntuples(result); ++row) {
            json details = json::object();
            try { details = json::parse(PQgetvalue(result, row, 6)); } catch (...) {}
            events.push_back({
                {"id", PQgetvalue(result, row, 0)},
                {"actorId", PQgetvalue(result, row, 1)},
                {"actorEmail", PQgetvalue(result, row, 2)},
                {"action", PQgetvalue(result, row, 3)},
                {"targetType", PQgetvalue(result, row, 4)},
                {"targetId", PQgetvalue(result, row, 5)},
                {"details", details},
                {"createdAt", PQgetvalue(result, row, 7)}
            });
        }
        PQclear(result);
        return json{{"events", events}};
    }

    json admin_metrics() {
        PGresult* result = PQexec(connection_,
            "SELECT status::text,count(*)::text FROM rides GROUP BY status ORDER BY status");
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not read ride metrics");
        }
        json counts = json::object();
        for (int i = 0; i < PQntuples(result); ++i) {
            counts[PQgetvalue(result, i, 0)] = std::stoi(PQgetvalue(result, i, 1));
        }
        PQclear(result);
        PGresult* drivers = PQexec(connection_,
            "SELECT count(*)::text FROM driver_profiles WHERE is_approved=true AND is_online=true "
            "AND last_location_at>now()-interval '5 minutes'");
        if (drivers == nullptr || PQresultStatus(drivers) != PGRES_TUPLES_OK ||
            PQntuples(drivers) != 1) {
            if (drivers != nullptr) PQclear(drivers);
            throw std::runtime_error("Could not read driver metrics");
        }
        const int online_drivers = std::stoi(PQgetvalue(drivers, 0, 0));
        PQclear(drivers);
        PGresult* outbox = PQexec(connection_,
            "SELECT count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL)::text,"
            "count(*) FILTER (WHERE dead_lettered_at IS NOT NULL)::text,"
            "COALESCE(EXTRACT(EPOCH FROM now()-min(created_at) FILTER "
            "(WHERE published_at IS NULL AND dead_lettered_at IS NULL))::integer,0)::text "
            "FROM ride_event_outbox");
        if (outbox == nullptr || PQresultStatus(outbox) != PGRES_TUPLES_OK ||
            PQntuples(outbox) != 1) {
            if (outbox != nullptr) PQclear(outbox);
            throw std::runtime_error("Could not read outbox metrics");
        }
        const int pending_outbox = std::stoi(PQgetvalue(outbox, 0, 0));
        const int dead_lettered_outbox = std::stoi(PQgetvalue(outbox, 0, 1));
        const int oldest_pending_age = std::stoi(PQgetvalue(outbox, 0, 2));
        PQclear(outbox);
        return json{{"ridesByStatus", counts}, {"onlineDrivers", online_drivers},
                    {"pendingOutboxEvents", pending_outbox},
                    {"deadLetteredOutboxEvents", dead_lettered_outbox},
                    {"oldestPendingOutboxAgeSeconds", oldest_pending_age}};
    }

    std::optional<json> get_ride(const std::string& ride_id, const std::string& actor_id,
                                  const std::string& role) {
        const char* params[] = {ride_id.c_str(), actor_id.c_str()};
        const char* sql = role == "admin"
            ? "SELECT id::text,status::text,passenger_id::text,driver_id::text,pickup_label,"
              "destination_label,route_distance_m,quoted_fare_paise,final_fare_paise,"
              "created_at::text,updated_at::text FROM rides WHERE id=$1::uuid"
            : "SELECT id::text,status::text,passenger_id::text,driver_id::text,pickup_label,"
              "destination_label,route_distance_m,quoted_fare_paise,final_fare_paise,"
              "created_at::text,updated_at::text FROM rides WHERE id=$1::uuid "
              "AND (passenger_id=$2::uuid OR driver_id=$2::uuid)";
        PGresult* result = PQexecParams(connection_, sql, role == "admin" ? 1 : 2,
                                        nullptr, params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not read ride");
        }
        if (PQntuples(result) == 0) {
            PQclear(result);
            return std::nullopt;
        }
        json ride{{"rideId", PQgetvalue(result, 0, 0)}, {"status", PQgetvalue(result, 0, 1)},
                  {"passengerId", PQgetvalue(result, 0, 2)},
                  {"pickup", PQgetvalue(result, 0, 4)},
                  {"destination", PQgetvalue(result, 0, 5)},
                  {"farePaise", std::stoi(PQgetvalue(result, 0, 7))},
                  {"currency", "INR"}, {"createdAt", PQgetvalue(result, 0, 9)},
                  {"updatedAt", PQgetvalue(result, 0, 10)}};
        if (!PQgetisnull(result, 0, 3)) ride["driverId"] = PQgetvalue(result, 0, 3);
        if (!PQgetisnull(result, 0, 6)) ride["distanceMeters"] = std::stoi(PQgetvalue(result, 0, 6));
        if (!PQgetisnull(result, 0, 8)) ride["finalFarePaise"] = std::stoi(PQgetvalue(result, 0, 8));
        const std::string current_status = PQgetvalue(result, 0, 1);
        const bool can_view_location = role != "admin" && !PQgetisnull(result, 0, 3) &&
            (current_status == "assigned" || current_status == "driver_arriving" || current_status == "in_progress");
        PQclear(result);
        if (can_view_location) {
            const char* location_params[] = {ride_id.c_str()};
            PGresult* location = PQexecParams(connection_,
                "SELECT d.current_latitude::text,d.current_longitude::text,d.last_location_at::text "
                "FROM driver_profiles d JOIN rides r ON r.driver_id=d.account_id "
                "WHERE r.id=$1::uuid AND r.status IN ('assigned','driver_arriving','in_progress') "
                "AND d.is_online=true AND d.last_location_at>now()-interval '2 minutes' "
                "AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL",
                1, nullptr, location_params, nullptr, nullptr, 0);
            if (location != nullptr && PQresultStatus(location) == PGRES_TUPLES_OK &&
                PQntuples(location) == 1) {
                ride["driverLocation"] = {
                    {"latitude", std::stod(PQgetvalue(location, 0, 0))},
                    {"longitude", std::stod(PQgetvalue(location, 0, 1))},
                    {"updatedAt", PQgetvalue(location, 0, 2)}
                };
            }
            if (location != nullptr) PQclear(location);
        }
        return ride;
    }

    json list_available_rides(const std::string& driver_id) {
        // Do not expose pickup/drop-off data to drivers who are offline or whose
        // last location is stale. Dispatch eligibility is checked again when accepting.
        const std::string radius_meters = std::to_string(dispatch_radius_meters());
        const char* params[] = {driver_id.c_str(), radius_meters.c_str()};
        PGresult* result = PQexecParams(connection_,
            "WITH eligible AS ("
            "SELECT r.id::text AS ride_id,r.pickup_label,r.destination_label,"
            "r.route_distance_m::text AS route_distance_m,r.quoted_fare_paise::text AS fare_paise,"
            "r.created_at::text AS created_at,"
            "(6371000.0 * acos(least(1.0::double precision,greatest(-1.0::double precision,"
            "sin(radians(d.current_latitude))*sin(radians(r.pickup_latitude)) + "
            "cos(radians(d.current_latitude))*cos(radians(r.pickup_latitude))*"
            "cos(radians(r.pickup_longitude-d.current_longitude)))))) AS pickup_distance_m "
            "FROM rides r JOIN driver_profiles d ON d.account_id=$1::uuid "
            "WHERE r.status IN ('requested','matching') AND r.driver_id IS NULL "
            "AND d.is_approved=true AND d.is_online=true "
            "AND d.last_location_at>now()-interval '5 minutes' "
            "AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL "
            "AND NOT EXISTS (SELECT 1 FROM driver_ride_declines declined "
            "WHERE declined.ride_id=r.id AND declined.driver_id=d.account_id) "
            "AND NOT EXISTS (SELECT 1 FROM rides active WHERE active.driver_id=d.account_id "
            "AND active.status IN ('assigned','driver_arriving','in_progress'))) "
            "SELECT ride_id,pickup_label,destination_label,route_distance_m,fare_paise,created_at,"
            "pickup_distance_m::integer FROM eligible WHERE pickup_distance_m<=$2::double precision "
            "ORDER BY pickup_distance_m ASC,created_at ASC LIMIT 100",
            2, nullptr, params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not list available rides");
        }
        json rides = json::array();
        for (int i = 0; i < PQntuples(result); ++i) {
            json ride{{"rideId", PQgetvalue(result, i, 0)},
                {"pickup", PQgetvalue(result, i, 1)},
                {"destination", PQgetvalue(result, i, 2)},
                {"farePaise", std::stoi(PQgetvalue(result, i, 4))},
                {"currency", "INR"}, {"createdAt", PQgetvalue(result, i, 5)}};
            if (!PQgetisnull(result, i, 3)) ride["distanceMeters"] = std::stoi(PQgetvalue(result, i, 3));
            if (!PQgetisnull(result, i, 6)) ride["pickupDistanceMeters"] = std::stoi(PQgetvalue(result, i, 6));
            rides.push_back(std::move(ride));
        }
        PQclear(result);
        return json{{"rides", rides}};
    }

    json list_rides(const std::string& passenger_id) {
        const char* params[] = {passenger_id.c_str()};
        PGresult* result = PQexecParams(connection_,
            "SELECT id::text,status::text,pickup_label,destination_label,quoted_fare_paise::text,"
            "final_fare_paise::text,created_at::text,completed_at::text "
            "FROM rides WHERE passenger_id=$1::uuid ORDER BY created_at DESC LIMIT 50",
            1, nullptr, params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not list rides");
        }
        json rides = json::array();
        for (int i = 0; i < PQntuples(result); ++i) {
            json ride{{"rideId", PQgetvalue(result, i, 0)},
                {"status", PQgetvalue(result, i, 1)}, {"pickup", PQgetvalue(result, i, 2)},
                {"destination", PQgetvalue(result, i, 3)},
                {"farePaise", std::stoi(PQgetvalue(result, i, 4))},
                {"currency", "INR"}, {"createdAt", PQgetvalue(result, i, 6)}};
            if (!PQgetisnull(result, i, 5)) ride["finalFarePaise"] = std::stoi(PQgetvalue(result, i, 5));
            if (!PQgetisnull(result, i, 7)) ride["completedAt"] = PQgetvalue(result, i, 7);
            rides.push_back(std::move(ride));
        }
        PQclear(result);
        return json{{"rides", rides}};
    }

    json cancel_ride(const std::string& ride_id, const std::string& passenger_id) {
        const auto command = [this](const char* sql) {
            PGresult* result = PQexec(connection_, sql);
            if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
                if (result != nullptr) PQclear(result);
                throw std::runtime_error("Database transaction command failed");
            }
            PQclear(result);
        };
        command("BEGIN");
        try {
            const char* params[] = {ride_id.c_str(), passenger_id.c_str()};
            PGresult* locked = PQexecParams(connection_,
                "SELECT status::text,driver_id::text FROM rides WHERE id=$1::uuid "
                "AND passenger_id=$2::uuid FOR UPDATE",
                2, nullptr, params, nullptr, nullptr, 0);
            if (locked == nullptr || PQresultStatus(locked) != PGRES_TUPLES_OK) {
                if (locked != nullptr) PQclear(locked);
                throw std::runtime_error("Could not lock ride");
            }
            if (PQntuples(locked) != 1) {
                PQclear(locked);
                throw std::domain_error("ride_not_found");
            }
            const std::string previous = PQgetvalue(locked, 0, 0);
            PQclear(locked);
            if (previous != "requested" && previous != "matching" &&
                previous != "assigned" && previous != "driver_arriving") {
                throw std::domain_error("ride_not_cancellable");
            }
            PGresult* updated = PQexecParams(connection_,
                "UPDATE rides SET status='cancelled',driver_id=NULL,cancelled_at=now(),updated_at=now() "
                "WHERE id=$1::uuid AND passenger_id=$2::uuid",
                2, nullptr, params, nullptr, nullptr, 0);
            if (updated == nullptr || PQresultStatus(updated) != PGRES_COMMAND_OK) {
                if (updated != nullptr) PQclear(updated);
                throw std::runtime_error("Could not cancel ride");
            }
            PQclear(updated);
            const char* event_params[] = {ride_id.c_str(), passenger_id.c_str(), previous.c_str()};
            PGresult* event = PQexecParams(connection_,
                "INSERT INTO ride_events (ride_id,actor_id,previous_status,new_status,details) "
                "VALUES ($1::uuid,$2::uuid,$3::ride_status,'cancelled','{\"source\":\"passenger\"}'::jsonb)",
                3, nullptr, event_params, nullptr, nullptr, 0);
            if (event == nullptr || PQresultStatus(event) != PGRES_COMMAND_OK) {
                if (event != nullptr) PQclear(event);
                throw std::runtime_error("Could not record cancellation event");
            }
            PQclear(event);
            command("COMMIT");
            return json{{"rideId", ride_id}, {"status", "cancelled"}};
        } catch (...) {
            PGresult* rollback = PQexec(connection_, "ROLLBACK");
            if (rollback != nullptr) PQclear(rollback);
            throw;
        }
    }

    void set_driver_availability(const std::string& driver_id, bool online,
                                 double latitude, double longitude) {
        const std::vector<std::string> owned = {
            driver_id, online ? "true" : "false", std::to_string(latitude), std::to_string(longitude)};
        std::vector<const char*> values;
        for (const auto& value : owned) values.push_back(value.c_str());
        PGresult* result = PQexecParams(connection_,
            "UPDATE driver_profiles SET is_online=$2::boolean,"
            "current_latitude=CASE WHEN $2::boolean THEN $3::double precision ELSE NULL END,"
            "current_longitude=CASE WHEN $2::boolean THEN $4::double precision ELSE NULL END,"
            "last_location_at=CASE WHEN $2::boolean THEN now() ELSE NULL END "
            "WHERE account_id=$1::uuid AND is_approved=true",
            static_cast<int>(values.size()), nullptr, values.data(), nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not update driver availability");
        }
        const bool updated = std::string(PQcmdTuples(result)) == "1";
        PQclear(result);
        if (!updated) throw std::domain_error("driver_profile_missing_or_not_approved");
    }

    json accept_ride(const std::string& ride_id, const std::string& driver_id) {
        const auto command = [this](const char* sql) {
            PGresult* result = PQexec(connection_, sql);
            if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
                if (result != nullptr) PQclear(result);
                throw std::runtime_error("Database transaction command failed");
            }
            PQclear(result);
        };
        command("BEGIN");
        try {
            const char* driver_params[] = {driver_id.c_str()};
            PGresult* driver = PQexecParams(connection_,
                "SELECT account_id::text,current_latitude::text,current_longitude::text "
                "FROM driver_profiles WHERE account_id=$1::uuid "
                "AND is_approved=true AND is_online=true AND last_location_at>now()-interval '5 minutes' "
                "AND current_latitude IS NOT NULL AND current_longitude IS NOT NULL FOR UPDATE",
                1, nullptr, driver_params, nullptr, nullptr, 0);
            if (driver == nullptr || PQresultStatus(driver) != PGRES_TUPLES_OK) {
                if (driver != nullptr) PQclear(driver);
                throw std::runtime_error("Could not lock driver profile");
            }
            const bool available = PQntuples(driver) == 1;
            double driver_latitude = 0.0;
            double driver_longitude = 0.0;
            if (available) {
                driver_latitude = std::stod(PQgetvalue(driver, 0, 1));
                driver_longitude = std::stod(PQgetvalue(driver, 0, 2));
            }
            PQclear(driver);
            if (!available) throw std::domain_error("driver_unavailable");

            PGresult* active = PQexecParams(connection_,
                "SELECT id::text FROM rides WHERE driver_id=$1::uuid "
                "AND status IN ('assigned','driver_arriving','in_progress') LIMIT 1",
                1, nullptr, driver_params, nullptr, nullptr, 0);
            if (active == nullptr || PQresultStatus(active) != PGRES_TUPLES_OK) {
                if (active != nullptr) PQclear(active);
                throw std::runtime_error("Could not check active driver rides");
            }
            const bool has_active = PQntuples(active) > 0;
            PQclear(active);
            if (has_active) throw std::domain_error("driver_has_active_ride");

            const char* ride_params[] = {ride_id.c_str()};
            PGresult* ride = PQexecParams(connection_,
                "SELECT status::text,pickup_latitude::text,pickup_longitude::text "
                "FROM rides WHERE id=$1::uuid FOR UPDATE",
                1, nullptr, ride_params, nullptr, nullptr, 0);
            if (ride == nullptr || PQresultStatus(ride) != PGRES_TUPLES_OK) {
                if (ride != nullptr) PQclear(ride);
                throw std::runtime_error("Could not lock ride");
            }
            if (PQntuples(ride) != 1) {
                PQclear(ride);
                throw std::domain_error("ride_not_found");
            }
            const std::string previous = PQgetvalue(ride, 0, 0);
            if (PQgetisnull(ride, 0, 1) || PQgetisnull(ride, 0, 2)) {
                PQclear(ride);
                throw std::domain_error("ride_location_unavailable");
            }
            const double pickup_latitude = std::stod(PQgetvalue(ride, 0, 1));
            const double pickup_longitude = std::stod(PQgetvalue(ride, 0, 2));
            PQclear(ride);
            if (previous != "requested" && previous != "matching") {
                throw std::domain_error("ride_not_available");
            }
            const char* decline_params[] = {ride_id.c_str(), driver_id.c_str()};
            PGresult* prior_decline = PQexecParams(connection_,
                "SELECT 1 FROM driver_ride_declines WHERE ride_id=$1::uuid AND driver_id=$2::uuid",
                2, nullptr, decline_params, nullptr, nullptr, 0);
            if (prior_decline == nullptr || PQresultStatus(prior_decline) != PGRES_TUPLES_OK) {
                if (prior_decline != nullptr) PQclear(prior_decline);
                throw std::runtime_error("Could not verify prior ride decline");
            }
            const bool declined = PQntuples(prior_decline) > 0;
            PQclear(prior_decline);
            if (declined) throw std::domain_error("ride_previously_declined");
            constexpr double earth_radius_m = 6371000.0;
            constexpr double degrees_to_radians = 3.14159265358979323846 / 180.0;
            const double lat1 = driver_latitude * degrees_to_radians;
            const double lat2 = pickup_latitude * degrees_to_radians;
            const double delta_lat = (pickup_latitude - driver_latitude) * degrees_to_radians;
            const double delta_lon = (pickup_longitude - driver_longitude) * degrees_to_radians;
            const double haversine = std::clamp(
                std::sin(delta_lat / 2.0) * std::sin(delta_lat / 2.0) +
                std::cos(lat1) * std::cos(lat2) *
                std::sin(delta_lon / 2.0) * std::sin(delta_lon / 2.0), 0.0, 1.0);
            const double pickup_distance_m = 2.0 * earth_radius_m * std::asin(std::sqrt(haversine));
            if (pickup_distance_m > static_cast<double>(dispatch_radius_meters())) {
                throw std::domain_error("ride_outside_dispatch_radius");
            }

            const char* offer_params[] = {ride_id.c_str(), driver_id.c_str()};
            PGresult* active_offer = PQexecParams(connection_,
                "SELECT id::text FROM ride_offers WHERE ride_id=$1::uuid AND driver_id=$2::uuid "
                "AND status='offered' AND expires_at>now() FOR UPDATE",
                2, nullptr, offer_params, nullptr, nullptr, 0);
            if (active_offer == nullptr || PQresultStatus(active_offer) != PGRES_TUPLES_OK) {
                if (active_offer != nullptr) PQclear(active_offer);
                throw std::runtime_error("Could not verify active driver offer");
            }
            const bool has_offer = PQntuples(active_offer) == 1;
            PQclear(active_offer);
            if (!has_offer) throw std::domain_error("driver_offer_expired_or_unavailable");

            const char* update_params[] = {ride_id.c_str(), driver_id.c_str()};
            PGresult* updated = PQexecParams(connection_,
                "UPDATE rides SET driver_id=$2::uuid,status='assigned',assigned_at=now(),updated_at=now() "
                "WHERE id=$1::uuid AND status IN ('requested','matching')",
                2, nullptr, update_params, nullptr, nullptr, 0);
            if (updated == nullptr || PQresultStatus(updated) != PGRES_COMMAND_OK ||
                std::string(PQcmdTuples(updated)) != "1") {
                if (updated != nullptr) PQclear(updated);
                throw std::domain_error("ride_not_available");
            }
            PQclear(updated);
            const char* event_params[] = {ride_id.c_str(), driver_id.c_str(), previous.c_str()};
            PGresult* event = PQexecParams(connection_,
                "INSERT INTO ride_events (ride_id,actor_id,previous_status,new_status,details) "
                "VALUES ($1::uuid,$2::uuid,$3::ride_status,'assigned','{\"source\":\"driver_accept\"}'::jsonb)",
                3, nullptr, event_params, nullptr, nullptr, 0);
            if (event == nullptr || PQresultStatus(event) != PGRES_COMMAND_OK) {
                if (event != nullptr) PQclear(event);
                throw std::runtime_error("Could not record assignment event");
            }
            PQclear(event);
            PGresult* accepted_offer = PQexecParams(connection_,
                "UPDATE ride_offers SET status='accepted',responded_at=now() "
                "WHERE ride_id=$1::uuid AND driver_id=$2::uuid AND status='offered' AND expires_at>now()",
                2, nullptr, update_params, nullptr, nullptr, 0);
            if (accepted_offer == nullptr || PQresultStatus(accepted_offer) != PGRES_COMMAND_OK ||
                std::string(PQcmdTuples(accepted_offer)) != "1") {
                if (accepted_offer != nullptr) PQclear(accepted_offer);
                throw std::domain_error("driver_offer_expired_or_unavailable");
            }
            PQclear(accepted_offer);
            const char* supersede_params[] = {ride_id.c_str(), driver_id.c_str()};
            PGresult* superseded = PQexecParams(connection_,
                "UPDATE ride_offers SET status='superseded',responded_at=now() "
                "WHERE ride_id=$1::uuid AND driver_id<>$2::uuid AND status='offered'",
                2, nullptr, supersede_params, nullptr, nullptr, 0);
            if (superseded == nullptr || PQresultStatus(superseded) != PGRES_COMMAND_OK) {
                if (superseded != nullptr) PQclear(superseded);
                throw std::runtime_error("Could not close competing driver offers");
            }
            PQclear(superseded);
            const char* driver_offer_params[] = {driver_id.c_str(), ride_id.c_str()};
            PGresult* other_driver_offers = PQexecParams(connection_,
                "UPDATE ride_offers SET status='superseded',responded_at=now() "
                "WHERE driver_id=$1::uuid AND ride_id<>$2::uuid AND status='offered'",
                2, nullptr, driver_offer_params, nullptr, nullptr, 0);
            if (other_driver_offers == nullptr || PQresultStatus(other_driver_offers) != PGRES_COMMAND_OK) {
                if (other_driver_offers != nullptr) PQclear(other_driver_offers);
                throw std::runtime_error("Could not close other offers for assigned driver");
            }
            PQclear(other_driver_offers);
            command("COMMIT");
            return json{{"rideId", ride_id}, {"driverId", driver_id}, {"status", "assigned"}};
        } catch (...) {
            PGresult* rollback = PQexec(connection_, "ROLLBACK");
            if (rollback != nullptr) PQclear(rollback);
            throw;
        }
    }

    json decline_ride(const std::string& ride_id, const std::string& driver_id) {
        const auto command = [this](const char* sql) {
            PGresult* result = PQexec(connection_, sql);
            if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
                if (result != nullptr) PQclear(result);
                throw std::runtime_error("Database transaction command failed");
            }
            PQclear(result);
        };
        command("BEGIN");
        try {
            // Match accept_ride's lock order (driver first, then ride) to avoid
            // a decline/accept deadlock when both actions race.
            const char* driver_params[] = {driver_id.c_str()};
            PGresult* driver = PQexecParams(connection_,
                "SELECT current_latitude::text,current_longitude::text "
                "FROM driver_profiles WHERE account_id=$1::uuid "
                "AND is_approved=true AND is_online=true AND last_location_at>now()-interval '5 minutes' "
                "AND current_latitude IS NOT NULL AND current_longitude IS NOT NULL FOR UPDATE",
                1, nullptr, driver_params, nullptr, nullptr, 0);
            if (driver == nullptr || PQresultStatus(driver) != PGRES_TUPLES_OK) {
                if (driver != nullptr) PQclear(driver);
                throw std::runtime_error("Could not lock driver profile");
            }
            if (PQntuples(driver) != 1) {
                PQclear(driver);
                throw std::domain_error("driver_unavailable");
            }
            const double driver_latitude = std::stod(PQgetvalue(driver, 0, 0));
            const double driver_longitude = std::stod(PQgetvalue(driver, 0, 1));
            PQclear(driver);

            PGresult* active = PQexecParams(connection_,
                "SELECT id::text FROM rides WHERE driver_id=$1::uuid "
                "AND status IN ('assigned','driver_arriving','in_progress') LIMIT 1",
                1, nullptr, driver_params, nullptr, nullptr, 0);
            if (active == nullptr || PQresultStatus(active) != PGRES_TUPLES_OK) {
                if (active != nullptr) PQclear(active);
                throw std::runtime_error("Could not check active driver rides");
            }
            const bool has_active = PQntuples(active) > 0;
            PQclear(active);
            if (has_active) throw std::domain_error("driver_has_active_ride");

            const char* ride_params[] = {ride_id.c_str()};
            PGresult* ride = PQexecParams(connection_,
                "SELECT status::text,driver_id::text,pickup_latitude::text,pickup_longitude::text "
                "FROM rides WHERE id=$1::uuid FOR UPDATE",
                1, nullptr, ride_params, nullptr, nullptr, 0);
            if (ride == nullptr || PQresultStatus(ride) != PGRES_TUPLES_OK) {
                if (ride != nullptr) PQclear(ride);
                throw std::runtime_error("Could not lock ride");
            }
            if (PQntuples(ride) != 1) {
                PQclear(ride);
                throw std::domain_error("ride_not_found");
            }
            const std::string status = PQgetvalue(ride, 0, 0);
            const bool already_assigned = !PQgetisnull(ride, 0, 1);
            const double pickup_latitude = std::stod(PQgetvalue(ride, 0, 2));
            const double pickup_longitude = std::stod(PQgetvalue(ride, 0, 3));
            PQclear(ride);
            if ((status != "requested" && status != "matching") || already_assigned) {
                throw std::domain_error("ride_not_available");
            }

            const char* offer_params[] = {ride_id.c_str(), driver_id.c_str()};
            PGresult* active_offer = PQexecParams(connection_,
                "SELECT id::text FROM ride_offers WHERE ride_id=$1::uuid AND driver_id=$2::uuid "
                "AND status='offered' AND expires_at>now() FOR UPDATE",
                2, nullptr, offer_params, nullptr, nullptr, 0);
            if (active_offer == nullptr || PQresultStatus(active_offer) != PGRES_TUPLES_OK) {
                if (active_offer != nullptr) PQclear(active_offer);
                throw std::runtime_error("Could not verify active driver offer");
            }
            const bool has_offer = PQntuples(active_offer) == 1;
            PQclear(active_offer);
            if (!has_offer) throw std::domain_error("driver_offer_expired_or_unavailable");

            constexpr double earth_radius_m = 6371000.0;
            constexpr double degrees_to_radians = 3.14159265358979323846 / 180.0;
            const double lat1 = driver_latitude * degrees_to_radians;
            const double lat2 = pickup_latitude * degrees_to_radians;
            const double delta_lat = (pickup_latitude - driver_latitude) * degrees_to_radians;
            const double delta_lon = (pickup_longitude - driver_longitude) * degrees_to_radians;
            const double haversine = std::clamp(
                std::sin(delta_lat / 2.0) * std::sin(delta_lat / 2.0) +
                std::cos(lat1) * std::cos(lat2) *
                std::sin(delta_lon / 2.0) * std::sin(delta_lon / 2.0), 0.0, 1.0);
            const double pickup_distance_m = 2.0 * earth_radius_m * std::asin(std::sqrt(haversine));
            if (pickup_distance_m > static_cast<double>(dispatch_radius_meters())) {
                throw std::domain_error("ride_outside_dispatch_radius");
            }

            const char* decline_params[] = {ride_id.c_str(), driver_id.c_str()};
            PGresult* inserted = PQexecParams(connection_,
                "INSERT INTO driver_ride_declines (ride_id,driver_id) "
                "VALUES ($1::uuid,$2::uuid) ON CONFLICT (ride_id,driver_id) DO NOTHING",
                2, nullptr, decline_params, nullptr, nullptr, 0);
            if (inserted == nullptr || PQresultStatus(inserted) != PGRES_COMMAND_OK) {
                if (inserted != nullptr) PQclear(inserted);
                throw std::runtime_error("Could not record ride decline");
            }
            PQclear(inserted);
            PGresult* marked = PQexecParams(connection_,
                "UPDATE ride_offers SET status='declined',responded_at=now() "
                "WHERE ride_id=$1::uuid AND driver_id=$2::uuid AND status='offered' AND expires_at>now()",
                2, nullptr, decline_params, nullptr, nullptr, 0);
            if (marked == nullptr || PQresultStatus(marked) != PGRES_COMMAND_OK ||
                std::string(PQcmdTuples(marked)) != "1") {
                if (marked != nullptr) PQclear(marked);
                throw std::domain_error("driver_offer_expired_or_unavailable");
            }
            PQclear(marked);
            command("COMMIT");
            return json{{"rideId", ride_id}, {"status", "declined"}, {"hiddenForDriver", true}};
        } catch (...) {
            PGresult* rollback = PQexec(connection_, "ROLLBACK");
            if (rollback != nullptr) PQclear(rollback);
            throw;
        }
    }

    json advance_ride(const std::string& ride_id, const std::string& driver_id,
                      const std::string& next_status) {
        const auto command = [this](const char* sql) {
            PGresult* result = PQexec(connection_, sql);
            if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
                if (result != nullptr) PQclear(result);
                throw std::runtime_error("Database transaction command failed");
            }
            PQclear(result);
        };
        command("BEGIN");
        try {
            const char* params[] = {ride_id.c_str(), driver_id.c_str()};
            PGresult* ride = PQexecParams(connection_,
                "SELECT status::text FROM rides WHERE id=$1::uuid AND driver_id=$2::uuid FOR UPDATE",
                2, nullptr, params, nullptr, nullptr, 0);
            if (ride == nullptr || PQresultStatus(ride) != PGRES_TUPLES_OK) {
                if (ride != nullptr) PQclear(ride);
                throw std::runtime_error("Could not lock assigned ride");
            }
            if (PQntuples(ride) != 1) {
                PQclear(ride);
                throw std::domain_error("ride_not_found");
            }
            const std::string previous = PQgetvalue(ride, 0, 0);
            PQclear(ride);
            const bool valid = (previous == "assigned" && next_status == "driver_arriving") ||
                (previous == "driver_arriving" && next_status == "in_progress") ||
                (previous == "in_progress" && next_status == "completed");
            if (!valid) throw std::domain_error("invalid_ride_transition");

            const char* update_params[] = {ride_id.c_str(), next_status.c_str()};
            PGresult* updated = PQexecParams(connection_,
                "UPDATE rides SET status=$2::ride_status,updated_at=now(),"
                "started_at=CASE WHEN $2='in_progress' THEN now() ELSE started_at END,"
                "completed_at=CASE WHEN $2='completed' THEN now() ELSE completed_at END,"
                "final_fare_paise=CASE WHEN $2='completed' THEN quoted_fare_paise ELSE final_fare_paise END "
                "WHERE id=$1::uuid",
                2, nullptr, update_params, nullptr, nullptr, 0);
            if (updated == nullptr || PQresultStatus(updated) != PGRES_COMMAND_OK) {
                if (updated != nullptr) PQclear(updated);
                throw std::runtime_error("Could not advance ride status");
            }
            PQclear(updated);
            const char* event_params[] = {ride_id.c_str(), driver_id.c_str(), previous.c_str(), next_status.c_str()};
            PGresult* event = PQexecParams(connection_,
                "INSERT INTO ride_events (ride_id,actor_id,previous_status,new_status,details) "
                "VALUES ($1::uuid,$2::uuid,$3::ride_status,$4::ride_status,'{\"source\":\"driver_status\"}'::jsonb)",
                4, nullptr, event_params, nullptr, nullptr, 0);
            if (event == nullptr || PQresultStatus(event) != PGRES_COMMAND_OK) {
                if (event != nullptr) PQclear(event);
                throw std::runtime_error("Could not record ride status event");
            }
            PQclear(event);
            command("COMMIT");
            return json{{"rideId", ride_id}, {"status", next_status}};
        } catch (...) {
            PGresult* rollback = PQexec(connection_, "ROLLBACK");
            if (rollback != nullptr) PQclear(rollback);
            throw;
        }
    }

    json create_ride(const std::string& passenger_id, const std::string& idempotency_key,
                     const std::string& quote_id) {
        const auto command = [this](const char* sql) {
            PGresult* result = PQexec(connection_, sql);
            if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
                if (result != nullptr) PQclear(result);
                throw std::runtime_error("Database transaction command failed");
            }
            PQclear(result);
        };
        command("BEGIN");
        try {
            const char* idem_params[] = {passenger_id.c_str(), idempotency_key.c_str(), quote_id.c_str()};
            PGresult* idem = PQexecParams(connection_,
                "INSERT INTO booking_idempotency (passenger_id,idempotency_key,request_fingerprint) "
                "VALUES ($1::uuid,$2,$3) ON CONFLICT DO NOTHING RETURNING passenger_id::text",
                3, nullptr, idem_params, nullptr, nullptr, 0);
            if (idem == nullptr || PQresultStatus(idem) != PGRES_TUPLES_OK) {
                if (idem != nullptr) PQclear(idem);
                throw std::runtime_error("Could not reserve idempotency key");
            }
            const bool reserved = PQntuples(idem) == 1;
            PQclear(idem);
            if (!reserved) {
                PGresult* existing = PQexecParams(connection_,
                    "SELECT request_fingerprint,ride_id::text FROM booking_idempotency "
                    "WHERE passenger_id=$1::uuid AND idempotency_key=$2",
                    2, nullptr, idem_params, nullptr, nullptr, 0);
                if (existing == nullptr || PQresultStatus(existing) != PGRES_TUPLES_OK ||
                    PQntuples(existing) != 1) {
                    if (existing != nullptr) PQclear(existing);
                    throw std::runtime_error("Could not read idempotency record");
                }
                const std::string fingerprint = PQgetvalue(existing, 0, 0);
                const bool has_ride = !PQgetisnull(existing, 0, 1);
                const std::string existing_ride = has_ride ? PQgetvalue(existing, 0, 1) : "";
                PQclear(existing);
                if (fingerprint != quote_id) throw std::domain_error("idempotency_conflict");
                if (!has_ride) throw std::runtime_error("Incomplete idempotency record");
                const char* ride_params[] = {existing_ride.c_str()};
                PGresult* ride = PQexecParams(connection_,
                    "SELECT id::text,status::text,quoted_fare_paise FROM rides WHERE id=$1::uuid",
                    1, nullptr, ride_params, nullptr, nullptr, 0);
                if (ride == nullptr || PQresultStatus(ride) != PGRES_TUPLES_OK || PQntuples(ride) != 1) {
                    if (ride != nullptr) PQclear(ride);
                    throw std::runtime_error("Could not read existing ride");
                }
                json result{{"rideId", PQgetvalue(ride, 0, 0)},
                            {"status", PQgetvalue(ride, 0, 1)},
                            {"farePaise", std::stoi(PQgetvalue(ride, 0, 2))},
                            {"currency", "INR"}, {"replayed", true}};
                PQclear(ride);
                command("COMMIT");
                return result;
            }

            const char* quote_params[] = {quote_id.c_str()};
            PGresult* quote = PQexecParams(connection_,
                "SELECT pickup_label,pickup_latitude::text,pickup_longitude::text,"
                "destination_label,destination_latitude::text,destination_longitude::text,"
                "route_distance_m::text,fare_paise::text FROM route_quotes "
                "WHERE id=$1::uuid AND consumed_at IS NULL AND expires_at>now() FOR UPDATE",
                1, nullptr, quote_params, nullptr, nullptr, 0);
            if (quote == nullptr || PQresultStatus(quote) != PGRES_TUPLES_OK) {
                if (quote != nullptr) PQclear(quote);
                throw std::runtime_error("Could not lock route quote");
            }
            if (PQntuples(quote) != 1) {
                PQclear(quote);
                throw std::domain_error("quote_expired_or_consumed");
            }
            const std::vector<std::string> values = {
                passenger_id, PQgetvalue(quote, 0, 0), PQgetvalue(quote, 0, 1),
                PQgetvalue(quote, 0, 2), PQgetvalue(quote, 0, 3), PQgetvalue(quote, 0, 4),
                PQgetvalue(quote, 0, 5), PQgetvalue(quote, 0, 6), PQgetvalue(quote, 0, 7),
                idempotency_key
            };
            PQclear(quote);
            std::vector<const char*> params;
            for (const auto& value : values) params.push_back(value.c_str());
            PGresult* inserted = PQexecParams(connection_,
                "INSERT INTO rides (passenger_id,status,pickup_label,pickup_latitude,pickup_longitude,"
                "destination_label,destination_latitude,destination_longitude,route_distance_m,"
                "quoted_fare_paise,idempotency_key) VALUES ($1::uuid,'requested',$2,$3::double precision,"
                "$4::double precision,$5,$6::double precision,$7::double precision,$8::integer,"
                "$9::integer,$10) RETURNING id::text",
                static_cast<int>(params.size()), nullptr, params.data(), nullptr, nullptr, 0);
            if (inserted == nullptr || PQresultStatus(inserted) != PGRES_TUPLES_OK ||
                PQntuples(inserted) != 1) {
                if (inserted != nullptr) PQclear(inserted);
                throw std::runtime_error("Could not create ride");
            }
            const std::string ride_id = PQgetvalue(inserted, 0, 0);
            PQclear(inserted);

            const char* event_params[] = {ride_id.c_str(), passenger_id.c_str()};
            PGresult* event = PQexecParams(connection_,
                "INSERT INTO ride_events (ride_id,actor_id,new_status,details) "
                "VALUES ($1::uuid,$2::uuid,'requested','{\"source\":\"api\"}'::jsonb)",
                2, nullptr, event_params, nullptr, nullptr, 0);
            if (event == nullptr || PQresultStatus(event) != PGRES_COMMAND_OK) {
                if (event != nullptr) PQclear(event);
                throw std::runtime_error("Could not record ride event");
            }
            PQclear(event);

            const char* consume_params[] = {quote_id.c_str()};
            PGresult* consumed = PQexecParams(connection_,
                "UPDATE route_quotes SET consumed_at=now() WHERE id=$1::uuid AND consumed_at IS NULL",
                1, nullptr, consume_params, nullptr, nullptr, 0);
            if (consumed == nullptr || PQresultStatus(consumed) != PGRES_COMMAND_OK ||
                std::string(PQcmdTuples(consumed)) != "1") {
                if (consumed != nullptr) PQclear(consumed);
                throw std::domain_error("quote_expired_or_consumed");
            }
            PQclear(consumed);

            const char* link_params[] = {passenger_id.c_str(), idempotency_key.c_str(), ride_id.c_str()};
            PGresult* linked = PQexecParams(connection_,
                "UPDATE booking_idempotency SET ride_id=$3::uuid "
                "WHERE passenger_id=$1::uuid AND idempotency_key=$2",
                3, nullptr, link_params, nullptr, nullptr, 0);
            if (linked == nullptr || PQresultStatus(linked) != PGRES_COMMAND_OK) {
                if (linked != nullptr) PQclear(linked);
                throw std::runtime_error("Could not finalize idempotency record");
            }
            PQclear(linked);
            command("COMMIT");
            return json{{"rideId", ride_id}, {"status", "requested"},
                        {"farePaise", std::stoi(values[8])}, {"currency", "INR"}, {"replayed", false}};
        } catch (...) {
            PGresult* rollback = PQexec(connection_, "ROLLBACK");
            if (rollback != nullptr) PQclear(rollback);
            throw;
        }
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
    explicit RateLimiter(unsigned limit = 30) : limit_(limit) {}
    bool allow(const std::string& key) {
        using clock = std::chrono::steady_clock;
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = clock::now();
        auto& bucket = buckets_[key];
        if (now - bucket.window >= std::chrono::minutes(1)) {
            bucket.window = now;
            bucket.count = 0;
        }
        if (++bucket.count > limit_) return false;
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
    unsigned limit_{30};
};

RateLimiter quote_limiter{30};
RateLimiter auth_limiter{10};
std::atomic<unsigned> active_sessions{0};
std::atomic<bool> shutdown_requested{false};
static_assert(std::atomic<bool>::is_always_lock_free,
              "signal handler requires a lock-free atomic boolean");

void request_shutdown(int) {
    shutdown_requested.store(true, std::memory_order_relaxed);
}

std::string make_request_id() {
    std::array<unsigned char, 16> bytes{};
    if (RAND_bytes(bytes.data(), static_cast<int>(bytes.size())) == 1) {
        return rideforge_security::base64url_encode(bytes.data(), bytes.size());
    }
    static std::atomic<std::uint64_t> fallback{0};
    return "fallback-" + std::to_string(++fallback);
}

http::response<http::string_body> response(http::status status, const json& body,
                                           const http::request<http::string_body>& request) {
    http::response<http::string_body> result{status, request.version()};
    result.set(http::field::server, "RideForge API");
    result.set(http::field::content_type, "application/json; charset=utf-8");
    result.set(http::field::cache_control, "no-store");
    result.set("X-Content-Type-Options", "nosniff");
    result.set("Referrer-Policy", "no-referrer");
    const auto request_id = request["X-Request-ID"];
    if (!request_id.empty()) result.set("X-Request-ID", std::string(request_id.data(), request_id.size()));
    const auto origin_view = request[http::field::origin];
    const std::string origin(origin_view.data(), origin_view.size());
    // Exact-match allowlist for role-specific HTTPS origins. Never reflect an
    // arbitrary Origin or use a wildcard with bearer-token authentication.
    const std::string allowed_origins = env_or("RIDEFORGE_ALLOWED_ORIGINS", "");
    const std::string allowed = allowed_origins.empty()
        ? env_or("RIDEFORGE_ALLOWED_ORIGIN", "http://localhost:5173")
        : allowed_origins;
    bool origin_allowed = false;
    std::size_t origin_start = 0;
    while (origin_start <= allowed.size()) {
        const std::size_t comma = allowed.find(',', origin_start);
        std::string candidate = allowed.substr(origin_start,
            comma == std::string::npos ? std::string::npos : comma - origin_start);
        const auto first = candidate.find_first_not_of(" \t\r\n");
        const auto last = candidate.find_last_not_of(" \t\r\n");
        candidate = first == std::string::npos ? std::string() : candidate.substr(first, last - first + 1);
        if (!candidate.empty() && origin == candidate) {
            origin_allowed = true;
            break;
        }
        if (comma == std::string::npos) break;
        origin_start = comma + 1;
    }
    if (!origin.empty() && origin_allowed) {
        result.set(http::field::access_control_allow_origin, origin);
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

void trim_in_place(std::string& value) {
    const auto first = value.find_first_not_of(" ");
    if (first == std::string::npos) {
        value.clear();
        return;
    }
    const auto last = value.find_last_not_of(" ");
    value = value.substr(first, last - first + 1);
}

http::response<http::string_body> handle_auth(
    const http::request<http::string_body>& request, const std::string& path, const std::string& ip) {
    if (!auth_limiter.allow(ip)) {
        return response(http::status::too_many_requests, {{"error", "rate_limited"}}, request);
    }
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
        trim_in_place(email);
        if (email.empty() || email.size() > 254 || password.empty() || password.size() > 128) {
            throw std::invalid_argument("email or password length is invalid");
        }
        Database database(env_or("DATABASE_URL", ""));
        if (registering) {
            std::string name = body["displayName"].get<std::string>();
            trim_in_place(name);
            const auto at = email.find('@');
            if (at == std::string::npos || at == 0 || email.find('.', at) == std::string::npos ||
                name.empty() || name.size() > 120 || password.size() < 12) {
                throw std::invalid_argument("valid email, displayName, and 12-character password required");
            }
            const std::string hash = rideforge_security::password_hash(password);
            const std::string id = database.create_passenger(email, name, hash);
            const std::string token = rideforge_security::sign_access_token(
                id, "passenger", env_or("RIDEFORGE_JWT_SECRET", ""));
            return response(http::status::created, {
                {"accessToken", token}, {"tokenType", "Bearer"}, {"expiresIn", 900},
                {"account", {{"id", id}, {"email", email}, {"displayName", name}, {"role", "passenger"}}}
            }, request);
        }
        const auto account = database.find_account(email);
        if (!account || !account->active ||
            !rideforge_security::verify_password(password, account->password_hash)) {
            return response(http::status::unauthorized, {{"error", "invalid_credentials"}}, request);
        }
        const std::string token = rideforge_security::sign_access_token(
            account->id, account->role, env_or("RIDEFORGE_JWT_SECRET", ""));
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

http::response<http::string_body> handle_booking(
    const http::request<http::string_body>& request) {
    if (request.body().size() > 16384) {
        return response(http::status::payload_too_large, {{"error", "request_too_large"}}, request);
    }
    try {
        const auto authorization_view = request[http::field::authorization];
        const std::string authorization(authorization_view.data(), authorization_view.size());
        if (authorization.rfind("Bearer ", 0) != 0) {
            return response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        }
        rideforge_security::Claims claims;
        try {
            claims = rideforge_security::verify_access_token(
                authorization.substr(7), env_or("RIDEFORGE_JWT_SECRET", ""));
        } catch (const std::exception&) {
            return response(http::status::unauthorized, {{"error", "invalid_access_token"}}, request);
        }
        if (claims.role != "passenger") {
            return response(http::status::forbidden, {{"error", "passenger_role_required"}}, request);
        }
        const auto key_view = request["Idempotency-Key"];
        const std::string key(key_view.data(), key_view.size());
        if (key.size() < 8 || key.size() > 160) {
            throw std::invalid_argument("Idempotency-Key must be between 8 and 160 characters");
        }
        const auto body = json::parse(request.body());
        if (!body.is_object() || !body.contains("quoteId") || !body["quoteId"].is_string()) {
            throw std::invalid_argument("quoteId is required");
        }
        const std::string quote_id = body["quoteId"].get<std::string>();
        Database database(env_or("DATABASE_URL", ""));
        const json ride = database.create_ride(claims.subject, key, quote_id);
        const auto status = ride.value("replayed", false) ? http::status::ok : http::status::created;
        return response(status, ride, request);
    } catch (const std::domain_error& error) {
        const std::string reason = error.what();
        return response(http::status::conflict,
            {{"error", reason == "idempotency_conflict" ? "idempotency_conflict" : "quote_unavailable"}}, request);
    } catch (const std::invalid_argument& error) {
        return response(http::status::unprocessable_entity, {{"error", error.what()}}, request);
    } catch (const json::exception&) {
        return response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
    } catch (const std::exception&) {
        return response(http::status::service_unavailable, {{"error", "booking_unavailable"}}, request);
    }
}

std::optional<rideforge_security::Claims> bearer_claims(
    const http::request<http::string_body>& request) {
    const auto header = request[http::field::authorization];
    const std::string authorization(header.data(), header.size());
    if (authorization.rfind("Bearer ", 0) != 0) return std::nullopt;
    try {
        return rideforge_security::verify_access_token(
            authorization.substr(7), env_or("RIDEFORGE_JWT_SECRET", ""));
    } catch (...) {
        return std::nullopt;
    }
}

#include "driver_routes.inc"
#include "driver_status.inc"
#include "driver_queue.inc"
#include "driver_history.inc"
#include "admin_ride_search.inc"
#include "support_routes.inc"

// Authenticated SSE stream. The outbox worker emits PostgreSQL NOTIFY messages only
// after the corresponding state change and published marker commit together. Clients
// reconnect with Last-Event-ID; persisted ride_events provide gap-free resynchronization.
bool stream_ride_events(beast::tcp_stream& stream,
                        const http::request<http::string_body>& request,
                        const std::string& path) {
    constexpr std::string_view prefix = "/api/v1/rides/";
    constexpr std::string_view suffix = "/events";
    if (request.method() != http::verb::get || path.rfind(prefix, 0) != 0 ||
        path.size() <= prefix.size() + suffix.size() ||
        path.substr(path.size() - suffix.size()) != suffix) return false;

    const std::string ride_id = path.substr(prefix.size(), path.size() - prefix.size() - suffix.size());
    const auto claims = bearer_claims(request);
    auto send_json_error = [&](http::status status, const json& body) {
        boost::system::error_code ec;
        auto result = response(status, body, request);
        result.keep_alive(false);
        http::write(stream, result, ec);
    };
    if (!claims) {
        send_json_error(http::status::unauthorized, {{"error", "authentication_required"}});
        return true;
    }

    try {
        Database database(env_or("DATABASE_URL", ""));
        if (!database.get_ride(ride_id, claims->subject, claims->role)) {
            send_json_error(http::status::not_found, {{"error", "ride_not_found"}});
            return true;
        }
    } catch (const std::exception&) {
        send_json_error(http::status::service_unavailable, {{"error", "event_stream_unavailable"}});
        return true;
    }

    std::uint64_t last_event_id = 0;
    const auto last_header = request["Last-Event-ID"];
    if (!last_header.empty()) {
        const std::string value(last_header.data(), last_header.size());
        // Event IDs are unsigned decimal integers. stoull alone accepts signs and
        // whitespace, which can turn a malformed cursor into a huge replay offset.
        if (value.empty() || !std::all_of(value.begin(), value.end(),
                [](unsigned char character) { return character >= '0' && character <= '9'; })) {
            send_json_error(http::status::bad_request, {{"error", "invalid_last_event_id"}});
            return true;
        }
        try {
            std::size_t consumed = 0;
            last_event_id = std::stoull(value, &consumed);
            if (consumed != value.size()) throw std::invalid_argument("invalid event id");
        } catch (...) {
            send_json_error(http::status::bad_request, {{"error", "invalid_last_event_id"}});
            return true;
        }
    }

    PGconn* connection = PQconnectdb(env_or("DATABASE_URL", "").c_str());
    if (connection == nullptr || PQstatus(connection) != CONNECTION_OK) {
        if (connection != nullptr) PQfinish(connection);
        send_json_error(http::status::service_unavailable, {{"error", "event_stream_unavailable"}});
        return true;
    }
    PGresult* listen = PQexec(connection, "LISTEN rideforge_ride_events");
    if (listen == nullptr || PQresultStatus(listen) != PGRES_COMMAND_OK) {
        if (listen != nullptr) PQclear(listen);
        PQfinish(connection);
        send_json_error(http::status::service_unavailable, {{"error", "event_stream_unavailable"}});
        return true;
    }
    PQclear(listen);

    http::response<http::empty_body> header{http::status::ok, request.version()};
    header.set(http::field::server, "RideForge API");
    header.set(http::field::content_type, "text/event-stream; charset=utf-8");
    header.set(http::field::cache_control, "no-cache, no-transform");
    header.set("X-Accel-Buffering", "no");
    const auto request_id = request["X-Request-ID"];
    if (!request_id.empty()) header.set("X-Request-ID", std::string(request_id.data(), request_id.size()));
    header.set(http::field::connection, "keep-alive");
    header.set("X-Content-Type-Options", "nosniff");
    const auto origin_view = request[http::field::origin];
    const std::string origin(origin_view.data(), origin_view.size());
    const std::string allowed_origins = env_or("RIDEFORGE_ALLOWED_ORIGINS", "");
    const std::string allowed = allowed_origins.empty()
        ? env_or("RIDEFORGE_ALLOWED_ORIGIN", "http://localhost:5173")
        : allowed_origins;
    bool origin_allowed = false;
    std::size_t origin_start = 0;
    while (origin_start <= allowed.size()) {
        const std::size_t comma = allowed.find(',', origin_start);
        std::string candidate = allowed.substr(origin_start,
            comma == std::string::npos ? std::string::npos : comma - origin_start);
        const auto first = candidate.find_first_not_of(" \t\r\n");
        const auto last = candidate.find_last_not_of(" \t\r\n");
        candidate = first == std::string::npos ? std::string() : candidate.substr(first, last - first + 1);
        if (!candidate.empty() && origin == candidate) { origin_allowed = true; break; }
        if (comma == std::string::npos) break;
        origin_start = comma + 1;
    }
    if (!origin.empty() && origin_allowed) {
        header.set(http::field::access_control_allow_origin, origin);
        header.set(http::field::vary, "Origin");
    }
    header.chunked(true);
    http::response_serializer<http::empty_body> serializer{header};
    boost::system::error_code ec;
    stream.expires_after(std::chrono::seconds(5));
    http::write_header(stream, serializer, ec);
    if (ec) { PQfinish(connection); return true; }

    auto send_chunk = [&](const std::string& payload) {
        stream.expires_after(std::chrono::seconds(5));
        asio::write(stream, http::make_chunk(asio::buffer(payload)), ec);
        return !ec;
    };
    auto emit_event = [&](std::uint64_t event_id, const std::string& status,
                          const std::string& created_at) {
        const json payload{{"eventId", event_id}, {"rideId", ride_id},
                           {"status", status}, {"createdAt", created_at}};
        const std::string frame = "id: " + std::to_string(event_id) +
            "\nevent: ride-status\ndata: " + payload.dump() + "\n\n";
        if (event_id > last_event_id) last_event_id = event_id;
        return send_chunk(frame);
    };

    // Replay in bounded pages after LISTEN is active, avoiding a lost-event race
    // without silently skipping events when a client reconnects after a long outage.
    bool replay_complete = false;
    while (!replay_complete && !ec) {
        const std::string after = std::to_string(last_event_id);
        const char* values[] = {ride_id.c_str(), after.c_str()};
        PGresult* replay = PQexecParams(connection,
            "SELECT id::text,new_status::text,created_at::text FROM ride_events "
            "WHERE ride_id=$1::uuid AND id>$2::bigint ORDER BY id LIMIT 100",
            2, nullptr, values, nullptr, nullptr, 0);
        if (replay == nullptr || PQresultStatus(replay) != PGRES_TUPLES_OK) {
            if (replay != nullptr) PQclear(replay);
            asio::write(stream, http::make_chunk_last(), ec);
            PQfinish(connection);
            return true;
        }
        const int rows = PQntuples(replay);
        for (int i = 0; i < rows && !ec; ++i) {
            const auto id = static_cast<std::uint64_t>(std::stoull(PQgetvalue(replay, i, 0)));
            if (!emit_event(id, PQgetvalue(replay, i, 1), PQgetvalue(replay, i, 2))) break;
        }
        PQclear(replay);
        replay_complete = rows < 100;
    }

    const auto started = std::chrono::steady_clock::now();
    auto heartbeat = started;
    while (!ec && std::chrono::steady_clock::now() - started < std::chrono::seconds(25)) {
        pollfd descriptor{PQsocket(connection), POLLIN, 0};
        const int ready = ::poll(&descriptor, 1, 500);
        if (ready > 0 && (descriptor.revents & POLLIN) != 0) {
            if (PQconsumeInput(connection) == 0) break;
            PGnotify* notification = nullptr;
            bool stream_writable = true;
            while ((notification = PQnotifies(connection)) != nullptr) {
                try {
                    const auto payload = json::parse(notification->extra);
                    if (payload.value("rideId", std::string()) == ride_id &&
                        payload.contains("eventId") && payload["eventId"].is_number()) {
                        const auto event_id = payload["eventId"].get<std::uint64_t>();
                        if (event_id > last_event_id) {
                            const std::string frame = "id: " + std::to_string(event_id) +
                                "\nevent: ride-status\ndata: " + payload.dump() + "\n\n";
                            last_event_id = event_id;
                            if (!send_chunk(frame)) stream_writable = false;
                        }
                    }
                } catch (...) { /* Ignore malformed notification payloads. */ }
                PQfreemem(notification);
                if (!stream_writable) break;
            }
        }
        const auto now = std::chrono::steady_clock::now();
        if (!ec && now - heartbeat >= std::chrono::seconds(10)) {
            if (!send_chunk(": heartbeat\n\n")) break;
            heartbeat = now;
        }
    }
    asio::write(stream, http::make_chunk_last(), ec);
    PQfinish(connection);
    return true;
}

void handle_request(tcp::socket socket) {
    const auto request_started = std::chrono::steady_clock::now();
    // Bound memory and connection occupancy before any route handler runs. Checking
    // request.body().size() after http::read is too late: Beast has already buffered it.
    beast::tcp_stream stream(std::move(socket));
    stream.expires_after(std::chrono::seconds(10));
    beast::flat_buffer buffer;
    http::request_parser<http::string_body> parser;
    parser.header_limit(8192);
    parser.body_limit(16384);
    boost::system::error_code ec;
    http::read(stream, buffer, parser, ec);
    if (ec) {
        if (ec == http::error::end_of_stream || ec == asio::error::operation_aborted ||
            ec == beast::error::timeout) {
            return;
        }
        const auto status = ec == http::error::body_limit
            ? http::status::payload_too_large : http::status::bad_request;
        http::response<http::string_body> rejected{status, 11};
        rejected.set(http::field::server, "RideForge API");
        rejected.set(http::field::content_type, "application/json; charset=utf-8");
        rejected.set(http::field::cache_control, "no-store");
        rejected.set("X-Content-Type-Options", "nosniff");
        rejected.keep_alive(false);
        rejected.body() = status == http::status::payload_too_large
            ? R"({"error":"request_too_large"})" : R"({"error":"invalid_http_request"})";
        rejected.prepare_payload();
        stream.expires_after(std::chrono::seconds(2));
        http::write(stream, rejected, ec);
        return;
    }
    auto request = parser.release();
    const std::string request_id = make_request_id();
    request.set("X-Request-ID", request_id);

    const std::string path(request.target().data(), request.target().size());
    if (stream_ride_events(stream, request, path)) return;

    http::response<http::string_body> result;
    if (request.method() == http::verb::post &&
        (path == "/api/v1/auth/register" || path == "/api/v1/auth/login")) {
        result = handle_auth(request, path, client_ip(stream.socket()));
    } else if (request.method() == http::verb::options) {
        // A 204 response must not run prepare_payload() with a string body: some
        // Beast versions reject payload metadata for no-content status responses.
        result = http::response<http::string_body>{http::status::no_content, request.version()};
        result.set(http::field::server, "RideForge API");
        result.set(http::field::cache_control, "no-store");
        result.set("X-Content-Type-Options", "nosniff");
        result.set("Referrer-Policy", "no-referrer");
        result.set("X-Request-ID", request_id);
        const auto origin_view = request[http::field::origin];
        const std::string origin(origin_view.data(), origin_view.size());
        const std::string allowed_origins = env_or("RIDEFORGE_ALLOWED_ORIGINS", "");
        const std::string allowed = allowed_origins.empty()
            ? env_or("RIDEFORGE_ALLOWED_ORIGIN", "http://localhost:5173")
            : allowed_origins;
        bool origin_allowed = false;
        std::size_t origin_start = 0;
        while (origin_start <= allowed.size()) {
            const std::size_t comma = allowed.find(',', origin_start);
            std::string candidate = allowed.substr(origin_start,
                comma == std::string::npos ? std::string::npos : comma - origin_start);
            const auto first = candidate.find_first_not_of(" \t\r\n");
            const auto last = candidate.find_last_not_of(" \t\r\n");
            candidate = first == std::string::npos ? std::string() : candidate.substr(first, last - first + 1);
            if (!candidate.empty() && origin == candidate) { origin_allowed = true; break; }
            if (comma == std::string::npos) break;
            origin_start = comma + 1;
        }
        if (!origin.empty() && origin_allowed) {
            result.set(http::field::access_control_allow_origin, origin);
            result.set(http::field::vary, "Origin");
        }
        result.set(http::field::access_control_allow_methods, "GET, POST, PUT, OPTIONS");
        result.set(http::field::access_control_allow_headers, "Content-Type, Authorization, Idempotency-Key, Last-Event-ID");
        result.set(http::field::access_control_max_age, "600");
        result.body().clear();
    } else if (request.method() == http::verb::get && path == "/api/v1/health") {
        try {
            Database database(env_or("DATABASE_URL", ""));
            result = response(http::status::ok, {{"status", "ok"}, {"database", "connected"}}, request);
        } catch (const std::exception&) {
            result = response(http::status::service_unavailable,
                              {{"status", "degraded"}, {"database", "unavailable"}}, request);
        }
    } else if (request.method() == http::verb::get && path == "/api/v1/ready") {
        try {
            Database database(env_or("DATABASE_URL", ""));
            if (!database.schema_ready()) {
                result = response(http::status::service_unavailable,
                                  {{"status", "not_ready"}, {"reason", "schema_incomplete"}}, request);
            } else {
                result = response(http::status::ok, {{"status", "ready"}}, request);
            }
        } catch (const std::exception&) {
            result = response(http::status::service_unavailable,
                              {{"status", "not_ready"}, {"reason", "database_unavailable"}}, request);
        }
    } else if (path == "/api/v1/support/reports" ||
               path == "/api/v1/admin/support-reports" ||
               path.rfind("/api/v1/admin/support-reports/", 0) == 0) {
        result = handle_support_reports(request, path);
    } else if (request.method() == http::verb::post && path == "/api/v1/rides") {
        result = handle_booking(request);
    } else if (request.method() == http::verb::post && path == "/api/v1/routes/quote") {
        if (!quote_limiter.allow(client_ip(stream.socket()))) {
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
                std::cerr << json{{"event", "quote_service_unavailable"}, {"requestId", std::string(request["X-Request-ID"].data(), request["X-Request-ID"].size())}}.dump() << '\n';
                result = response(http::status::service_unavailable,
                                  {{"error", "quote_service_unavailable"}}, request);
            }
        }
    } else if (request.method() == http::verb::put && path == "/api/v1/driver/availability") {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else if (claims->role != "driver") {
            result = response(http::status::forbidden, {{"error", "driver_role_required"}}, request);
        } else {
            try {
                const auto body = json::parse(request.body());
                if (!body.is_object() || !body.contains("online") || !body["online"].is_boolean()) {
                    throw std::invalid_argument("online is required");
                }
                const bool online = body["online"].get<bool>();
                double latitude = 0.0;
                double longitude = 0.0;
                if (online) {
                    if (!body.contains("latitude") || !body["latitude"].is_number() ||
                        !body.contains("longitude") || !body["longitude"].is_number()) {
                        throw std::invalid_argument("latitude and longitude are required when going online");
                    }
                    latitude = body["latitude"].get<double>();
                    longitude = body["longitude"].get<double>();
                    if (!std::isfinite(latitude) || latitude < -90 || latitude > 90 ||
                        !std::isfinite(longitude) || longitude < -180 || longitude > 180) {
                        throw std::invalid_argument("invalid_coordinates");
                    }
                }
                // Offline requests intentionally do not require or retain precise coordinates.
                Database database(env_or("DATABASE_URL", ""));
                database.set_driver_availability(claims->subject, online, latitude, longitude);
                result = response(http::status::ok, {{"online", online}, {"updated", true}}, request);
            } catch (const std::domain_error& error) {
                result = response(http::status::forbidden, {{"error", error.what()}}, request);
            } catch (const std::invalid_argument& error) {
                result = response(http::status::unprocessable_entity, {{"error", error.what()}}, request);
            } catch (const json::exception&) {
                result = response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
            } catch (const std::exception&) {
                result = response(http::status::service_unavailable, {{"error", "driver_unavailable"}}, request);
            }
        }
    } else if (request.method() == http::verb::get && path == "/api/v1/driver/rides") {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else if (claims->role != "driver") {
            result = response(http::status::forbidden, {{"error", "driver_role_required"}}, request);
        } else {
            try {
                Database database(env_or("DATABASE_URL", ""));
                result = response(http::status::ok, database.list_available_rides(claims->subject), request);
            } catch (const std::exception&) {
                result = response(http::status::service_unavailable, {{"error", "driver_queue_unavailable"}}, request);
            }
        }
    } else if (path.rfind("/api/v1/driver/rides/", 0) == 0 &&
               request.method() == http::verb::post) {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else if (claims->role != "driver") {
            result = response(http::status::forbidden, {{"error", "driver_role_required"}}, request);
        } else {
            const std::string prefix = "/api/v1/driver/rides/";
            const bool accepting = path.size() > prefix.size() + 7 &&
                path.substr(path.size() - 7) == "/accept";
            const bool declining = path.size() > prefix.size() + 8 &&
                path.substr(path.size() - 8) == "/decline";
            const bool changing_status = path.size() > prefix.size() + 7 &&
                path.substr(path.size() - 7) == "/status";
            if (!accepting && !declining && !changing_status) {
                result = response(http::status::not_found, {{"error", "not_found"}}, request);
            } else {
                const std::size_t suffix_size = declining ? 8 : 7;
                const std::string ride_id = path.substr(prefix.size(), path.size() - prefix.size() - suffix_size);
                try {
                    Database database(env_or("DATABASE_URL", ""));
                    if (accepting) {
                        result = response(http::status::ok, database.accept_ride(ride_id, claims->subject), request);
                    } else if (declining) {
                        result = response(http::status::ok, database.decline_ride(ride_id, claims->subject), request);
                    } else {
                        if (request.body().size() > 4096) throw std::invalid_argument("request_too_large");
                        const auto body = json::parse(request.body());
                        if (!body.is_object() || !body.contains("status") || !body["status"].is_string()) {
                            throw std::invalid_argument("status_required");
                        }
                        const std::string next_status = body["status"].get<std::string>();
                        if (next_status != "driver_arriving" && next_status != "in_progress" &&
                            next_status != "completed") {
                            throw std::invalid_argument("unsupported_ride_status");
                        }
                        result = response(http::status::ok,
                            database.advance_ride(ride_id, claims->subject, next_status), request);
                    }
                } catch (const std::domain_error& error) {
                    const std::string reason = error.what();
                    const auto status = reason == "ride_not_found" ? http::status::not_found : http::status::conflict;
                    result = response(status, {{"error", reason}}, request);
                } catch (const std::invalid_argument& error) {
                    result = response(http::status::unprocessable_entity, {{"error", error.what()}}, request);
                } catch (const json::exception&) {
                    result = response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
                } catch (const std::exception&) {
                    result = response(http::status::service_unavailable, {{"error", "driver_action_unavailable"}}, request);
                }
            }
        }
    } else if (path == "/api/v1/admin/drivers" &&
               (request.method() == http::verb::get || request.method() == http::verb::post)) {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else if (claims->role != "admin") {
            result = response(http::status::forbidden, {{"error", "admin_role_required"}}, request);
        } else {
            try {
                Database database(env_or("DATABASE_URL", ""));
                if (request.method() == http::verb::get) {
                    result = response(http::status::ok, database.list_drivers(), request);
                } else {
                    if (request.body().size() > 16384) {
                        throw std::invalid_argument("request_too_large");
                    }
                    const auto body = json::parse(request.body());
                    if (!body.is_object() || !body.contains("email") || !body["email"].is_string() ||
                        !body.contains("displayName") || !body["displayName"].is_string() ||
                        !body.contains("password") || !body["password"].is_string() ||
                        !body.contains("vehicleRegistration") || !body["vehicleRegistration"].is_string()) {
                        throw std::invalid_argument("email, displayName, password and vehicleRegistration are required");
                    }
                    std::string email = body["email"].get<std::string>();
                    std::string name = body["displayName"].get<std::string>();
                    std::string vehicle = body["vehicleRegistration"].get<std::string>();
                    const std::string password = body["password"].get<std::string>();
                    std::transform(email.begin(), email.end(), email.begin(),
                        [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
                    trim_in_place(email);
                    trim_in_place(name);
                    trim_in_place(vehicle);
                    std::transform(vehicle.begin(), vehicle.end(), vehicle.begin(),
                        [](unsigned char ch) { return static_cast<char>(std::toupper(ch)); });
                    const auto at = email.find('@');
                    if (email.empty() || email.size() > 254 || at == std::string::npos ||
                        at == 0 || email.find('.', at) == std::string::npos ||
                        name.empty() || name.size() > 120 || password.size() < 12 ||
                        password.size() > 128 || vehicle.size() < 3 || vehicle.size() > 32) {
                        throw std::invalid_argument("valid email, displayName, 12-128 character password and vehicle registration required");
                    }
                    const std::string hash = rideforge_security::password_hash(password);
                    const std::string driver_id = database.create_driver(email, name, hash, vehicle, claims->subject);
                    result = response(http::status::created, {
                        {"driverId", driver_id}, {"email", email}, {"displayName", name},
                        {"vehicleRegistration", vehicle}, {"approved", false}, {"online", false}
                    }, request);
                }
            } catch (const std::domain_error& error) {
                result = response(http::status::conflict, {{"error", error.what()}}, request);
            } catch (const std::invalid_argument& error) {
                result = response(http::status::unprocessable_entity, {{"error", error.what()}}, request);
            } catch (const json::exception&) {
                result = response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
            } catch (const std::exception&) {
                result = response(http::status::service_unavailable, {{"error", "driver_management_unavailable"}}, request);
            }
        }
    } else if (path.rfind("/api/v1/admin/drivers/", 0) == 0 &&
               request.method() == http::verb::put &&
               path.size() > std::string("/api/v1/admin/drivers/").size() + std::string("/approval").size() &&
               path.substr(path.size() - std::string("/approval").size()) == "/approval") {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else if (claims->role != "admin") {
            result = response(http::status::forbidden, {{"error", "admin_role_required"}}, request);
        } else {
            const std::string prefix = "/api/v1/admin/drivers/";
            const std::string driver_id = path.substr(prefix.size(), path.size() - prefix.size() - std::string("/approval").size());
            try {
                if (request.body().size() > 4096) throw std::invalid_argument("request_too_large");
                const auto body = json::parse(request.body());
                if (!body.is_object() || !body.contains("approved") || !body["approved"].is_boolean()) {
                    throw std::invalid_argument("approved boolean is required");
                }
                Database database(env_or("DATABASE_URL", ""));
                result = response(http::status::ok,
                    database.set_driver_approval(driver_id, claims->subject, body["approved"].get<bool>()), request);
            } catch (const std::domain_error& error) {
                result = response(http::status::not_found, {{"error", error.what()}}, request);
            } catch (const std::invalid_argument& error) {
                result = response(http::status::unprocessable_entity, {{"error", error.what()}}, request);
            } catch (const json::exception&) {
                result = response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
            } catch (const std::exception&) {
                result = response(http::status::service_unavailable, {{"error", "driver_management_unavailable"}}, request);
            }
        }
    } else if (request.method() == http::verb::get &&
               (path == "/api/v1/admin/audit" || path.rfind("/api/v1/admin/audit?", 0) == 0)) {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else if (claims->role != "admin") {
            result = response(http::status::forbidden, {{"error", "admin_role_required"}}, request);
        } else {
            try {
                int limit = 50;
                const auto query = request.target().find("?limit=");
                if (query != beast::string_view::npos) {
                    const std::string raw(request.target().substr(query + 7));
                    if (raw.empty() || raw.find_first_not_of("0123456789") != std::string::npos ||
                        raw.size() > 3) {
                        result = response(http::status::bad_request, {{"error", "invalid_limit"}}, request);
                    } else {
                        limit = std::stoi(raw);
                        if (limit < 1 || limit > 100) {
                            result = response(http::status::bad_request, {{"error", "invalid_limit"}}, request);
                        } else {
                            Database database(env_or("DATABASE_URL", ""));
                            result = response(http::status::ok, database.admin_audit_events(limit), request);
                        }
                    }
                } else {
                    Database database(env_or("DATABASE_URL", ""));
                    result = response(http::status::ok, database.admin_audit_events(limit), request);
                }
            } catch (const std::exception&) {
                result = response(http::status::service_unavailable, {{"error", "audit_unavailable"}}, request);
            }
        }
    } else if (request.method() == http::verb::get &&
               (path == "/api/v1/admin/rides" || path.rfind("/api/v1/admin/rides?", 0) == 0)) {
        result = handle_admin_ride_search(request, path);
    } else if (request.method() == http::verb::get && path == "/api/v1/admin/metrics") {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else if (claims->role != "admin") {
            result = response(http::status::forbidden, {{"error", "admin_role_required"}}, request);
        } else {
            try {
                Database database(env_or("DATABASE_URL", ""));
                result = response(http::status::ok, database.admin_metrics(), request);
            } catch (const std::exception&) {
                result = response(http::status::service_unavailable, {{"error", "metrics_unavailable"}}, request);
            }
        }
    } else if (request.method() == http::verb::get && path == "/api/v1/driver/rides/history") {
        result = handle_driver_history(request);
    } else if (request.method() == http::verb::get && path == "/api/v1/driver/rides") {
        result = handle_driver_queue(request);
    } else if (request.method() == http::verb::post &&
               path.rfind("/api/v1/driver/rides/", 0) == 0 &&
               path.size() > 7 && path.substr(path.size() - 7) == "/accept") {
        result = handle_driver_accept(request, path);
    } else if (request.method() == http::verb::post &&
               path.rfind("/api/v1/driver/rides/", 0) == 0 &&
               path.size() > 8 && path.substr(path.size() - 8) == "/decline") {
        result = handle_driver_decline(request, path);
    } else if (request.method() == http::verb::put &&
               path.rfind("/api/v1/driver/rides/", 0) == 0 &&
               path.size() > 7 && path.substr(path.size() - 7) == "/status") {
        result = handle_driver_status(request, path);
    } else if (request.method() == http::verb::get && path == "/api/v1/rides") {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else if (claims->role != "passenger") {
            result = response(http::status::forbidden, {{"error", "passenger_role_required"}}, request);
        } else {
            try {
                Database database(env_or("DATABASE_URL", ""));
                result = response(http::status::ok, database.list_rides(claims->subject), request);
            } catch (const std::exception&) {
                result = response(http::status::service_unavailable, {{"error", "history_unavailable"}}, request);
            }
        }
    } else if (path.rfind("/api/v1/rides/", 0) == 0 &&
               (request.method() == http::verb::get ||
                (request.method() == http::verb::post && path.size() > 7 &&
                 path.substr(path.size() - 7) == "/cancel"))) {
        const auto claims = bearer_claims(request);
        if (!claims) {
            result = response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
        } else {
            const bool cancelling = request.method() == http::verb::post;
            const std::string prefix = "/api/v1/rides/";
            const std::string ride_id = path.substr(prefix.size(),
                path.size() - prefix.size() - (cancelling ? 7 : 0));
            try {
                Database database(env_or("DATABASE_URL", ""));
                if (cancelling) {
                    if (claims->role != "passenger") {
                        result = response(http::status::forbidden, {{"error", "passenger_role_required"}}, request);
                    } else {
                        result = response(http::status::ok, database.cancel_ride(ride_id, claims->subject), request);
                    }
                } else {
                    const auto ride = database.get_ride(ride_id, claims->subject, claims->role);
                    result = ride ? response(http::status::ok, *ride, request)
                                  : response(http::status::not_found, {{"error", "ride_not_found"}}, request);
                }
            } catch (const std::domain_error& error) {
                const std::string reason = error.what();
                result = reason == "ride_not_found"
                    ? response(http::status::not_found, {{"error", reason}}, request)
                    : response(http::status::conflict, {{"error", reason}}, request);
            } catch (const std::exception&) {
                result = response(http::status::service_unavailable, {{"error", "ride_unavailable"}}, request);
            }
        }
    } else {
        result = response(http::status::not_found, {{"error", "not_found"}}, request);
    }

    // This server processes exactly one request per connection; do not advertise keep-alive.
    result.keep_alive(false);
    stream.expires_after(std::chrono::seconds(5));
    http::write(stream, result, ec);
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - request_started).count();
    const auto query_pos = path.find('?');
    const std::string log_path = path.substr(0, query_pos);
    std::cerr << json{{"event", "http_request_completed"}, {"requestId", request_id},
        {"method", std::string(request.method_string())}, {"path", log_path},
        {"status", result.result_int()}, {"durationMs", elapsed},
        {"responseWritten", !ec}}.dump() << '\n';
    stream.socket().shutdown(tcp::socket::shutdown_send, ec);
}

} // namespace

int main() {
    try {
        (void)dispatch_radius_meters();
    } catch (const std::exception&) {
        std::cerr << "{\"event\":\"invalid_dispatch_radius_configuration\"}\n";
        return 2;
    }
    curl_global_init(CURL_GLOBAL_DEFAULT);
    std::signal(SIGINT, request_shutdown);
    std::signal(SIGTERM, request_shutdown);
    const auto address = asio::ip::make_address(env_or("RIDEFORGE_BIND_ADDRESS", "0.0.0.0"));
    const unsigned short port = static_cast<unsigned short>(std::stoul(env_or("PORT", "8080")));
    asio::io_context context{1};
    tcp::acceptor acceptor{context, {address, port}};
    boost::system::error_code acceptor_error;
    acceptor.non_blocking(true, acceptor_error);
    if (acceptor_error) {
        std::cerr << json{{"event", "listener_setup_failed"}, {"reason", acceptor_error.message()}}.dump() << '\n';
        return 1;
    }
    std::cerr << json{{"event", "api_started"}, {"address", address.to_string()}, {"port", port}}.dump() << '\n';
    while (!shutdown_requested.load(std::memory_order_relaxed)) {
        tcp::socket socket{context};
        boost::system::error_code accept_error;
        acceptor.accept(socket, accept_error);
        if (accept_error) {
            if (accept_error == asio::error::would_block ||
                accept_error == asio::error::try_again ||
                accept_error == asio::error::interrupted) {
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
                continue;
            }
            if (shutdown_requested.load(std::memory_order_relaxed)) break;
            std::cerr << json{{"event", "listener_accept_failed"}, {"reason", accept_error.message()}}.dump() << '\n';
            break;
        }
        if (active_sessions.fetch_add(1, std::memory_order_relaxed) >= 64) {
            active_sessions.fetch_sub(1, std::memory_order_relaxed);
            boost::system::error_code close_error;
            socket.close(close_error);
            continue;
        }
        std::thread([socket = std::move(socket)]() mutable {
            try { handle_request(std::move(socket)); } catch (...) {}
            active_sessions.fetch_sub(1, std::memory_order_relaxed);
        }).detach();
    }

    const auto drain_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(30);
    while (active_sessions.load(std::memory_order_relaxed) != 0 &&
           std::chrono::steady_clock::now() < drain_deadline) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    const unsigned remaining = active_sessions.load(std::memory_order_relaxed);
    std::cerr << json{{"event", "api_shutdown"}, {"remainingSessions", remaining},
        {"graceful", remaining == 0}}.dump() << '\n';
    return remaining == 0 ? 0 : 1;
}

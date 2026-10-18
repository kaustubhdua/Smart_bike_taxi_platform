#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <curl/curl.h>
#include <libpq-fe.h>
#include <nlohmann/json.hpp>
#include "security.hpp"

#include <algorithm>
#include <atomic>
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
        env_or("SAARTHI_GEOCODING_URL", "https://nominatim.openstreetmap.org/search") +
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
        env_or("SAARTHI_ROUTING_URL", "https://router.project-osrm.org/route/v1/driving") + "/" +
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
            "SELECT count(*)::text FROM driver_profiles WHERE is_online=true "
            "AND last_location_at>now()-interval '5 minutes'");
        if (drivers == nullptr || PQresultStatus(drivers) != PGRES_TUPLES_OK ||
            PQntuples(drivers) != 1) {
            if (drivers != nullptr) PQclear(drivers);
            throw std::runtime_error("Could not read driver metrics");
        }
        const int online_drivers = std::stoi(PQgetvalue(drivers, 0, 0));
        PQclear(drivers);
        return json{{"ridesByStatus", counts}, {"onlineDrivers", online_drivers}};
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
        PQclear(result);
        return ride;
    }

    json list_available_rides(const std::string& driver_id) {
        // Do not expose pickup/drop-off data to drivers who are offline or whose
        // last location is stale. Dispatch eligibility is checked again when accepting.
        const char* params[] = {driver_id.c_str()};
        PGresult* result = PQexecParams(connection_,
            "SELECT r.id::text,r.pickup_label,r.destination_label,r.route_distance_m::text,"
            "r.quoted_fare_paise::text,r.created_at::text FROM rides r "
            "WHERE r.status IN ('requested','matching') AND r.driver_id IS NULL "
            "AND EXISTS (SELECT 1 FROM driver_profiles d WHERE d.account_id=$1::uuid "
            "AND d.is_online=true AND d.last_location_at>now()-interval '5 minutes') "
            "ORDER BY r.created_at ASC LIMIT 100",
            1, nullptr, params, nullptr, nullptr, 0);
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
            rides.push_back(std::move(ride));
        }
        PQclear(result);
        return json{{"rides", rides}};
    }

    json list_rides(const std::string& passenger_id) {
        const char* params[] = {passenger_id.c_str()};
        PGresult* result = PQexecParams(connection_,
            "SELECT id::text,status::text,pickup_label,destination_label,quoted_fare_paise,created_at::text "
            "FROM rides WHERE passenger_id=$1::uuid ORDER BY created_at DESC LIMIT 50",
            1, nullptr, params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not list rides");
        }
        json rides = json::array();
        for (int i = 0; i < PQntuples(result); ++i) {
            rides.push_back({{"rideId", PQgetvalue(result, i, 0)},
                {"status", PQgetvalue(result, i, 1)}, {"pickup", PQgetvalue(result, i, 2)},
                {"destination", PQgetvalue(result, i, 3)},
                {"farePaise", std::stoi(PQgetvalue(result, i, 4))},
                {"currency", "INR"}, {"createdAt", PQgetvalue(result, i, 5)}});
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
            "UPDATE driver_profiles SET is_online=$2::boolean,current_latitude=$3::double precision,"
            "current_longitude=$4::double precision,last_location_at=now() WHERE account_id=$1::uuid",
            static_cast<int>(values.size()), nullptr, values.data(), nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_COMMAND_OK) {
            if (result != nullptr) PQclear(result);
            throw std::runtime_error("Could not update driver availability");
        }
        const bool updated = std::string(PQcmdTuples(result)) == "1";
        PQclear(result);
        if (!updated) throw std::domain_error("driver_profile_missing");
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
                "SELECT account_id::text FROM driver_profiles WHERE account_id=$1::uuid "
                "AND is_online=true AND last_location_at>now()-interval '5 minutes' FOR UPDATE",
                1, nullptr, driver_params, nullptr, nullptr, 0);
            if (driver == nullptr || PQresultStatus(driver) != PGRES_TUPLES_OK) {
                if (driver != nullptr) PQclear(driver);
                throw std::runtime_error("Could not lock driver profile");
            }
            const bool available = PQntuples(driver) == 1;
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
                "SELECT status::text FROM rides WHERE id=$1::uuid FOR UPDATE",
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
            PQclear(ride);
            if (previous != "requested" && previous != "matching") {
                throw std::domain_error("ride_not_available");
            }

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
            command("COMMIT");
            return json{{"rideId", ride_id}, {"driverId", driver_id}, {"status", "assigned"}};
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
        saarthi_security::Claims claims;
        try {
            claims = saarthi_security::verify_access_token(
                authorization.substr(7), env_or("SAARTHI_JWT_SECRET", ""));
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

std::optional<saarthi_security::Claims> bearer_claims(
    const http::request<http::string_body>& request) {
    const auto header = request[http::field::authorization];
    const std::string authorization(header.data(), header.size());
    if (authorization.rfind("Bearer ", 0) != 0) return std::nullopt;
    try {
        return saarthi_security::verify_access_token(
            authorization.substr(7), env_or("SAARTHI_JWT_SECRET", ""));
    } catch (...) {
        return std::nullopt;
    }
}

#include "driver_routes.inc"
#include "driver_status.inc"
#include "driver_queue.inc"

void handle_request(tcp::socket socket) {
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
        rejected.set(http::field::server, "Saarthi API");
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

    http::response<http::string_body> result;
    const std::string path(request.target().data(), request.target().size());
    if (request.method() == http::verb::post &&
        (path == "/api/v1/auth/register" || path == "/api/v1/auth/login")) {
        result = handle_auth(request, path, client_ip(stream.socket()));
    } else if (request.method() == http::verb::options) {
        result = response(http::status::no_content, json::object(), request);
        result.set(http::field::access_control_allow_methods, "GET, POST, PUT, OPTIONS");
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
                std::cerr << "Quote request failed: " << error.what() << '\n';
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
                if (!body.is_object() || !body.contains("online") || !body["online"].is_boolean() ||
                    !body.contains("latitude") || !body["latitude"].is_number() ||
                    !body.contains("longitude") || !body["longitude"].is_number()) {
                    throw std::invalid_argument("online, latitude and longitude are required");
                }
                const double latitude = body["latitude"].get<double>();
                const double longitude = body["longitude"].get<double>();
                if (!std::isfinite(latitude) || latitude < -90 || latitude > 90 ||
                    !std::isfinite(longitude) || longitude < -180 || longitude > 180) {
                    throw std::invalid_argument("invalid_coordinates");
                }
                Database database(env_or("DATABASE_URL", ""));
                database.set_driver_availability(claims->subject, body["online"].get<bool>(), latitude, longitude);
                result = response(http::status::ok, {{"online", body["online"]}, {"updated", true}}, request);
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
            const bool changing_status = path.size() > prefix.size() + 7 &&
                path.substr(path.size() - 7) == "/status";
            if (!accepting && !changing_status) {
                result = response(http::status::not_found, {{"error", "not_found"}}, request);
            } else {
                const std::string ride_id = path.substr(prefix.size(), path.size() - prefix.size() - 7);
                try {
                    Database database(env_or("DATABASE_URL", ""));
                    if (accepting) {
                        result = response(http::status::ok, database.accept_ride(ride_id, claims->subject), request);
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
    } else if (request.method() == http::verb::get && path == "/api/v1/driver/rides") {
        result = handle_driver_queue(request);
    } else if (request.method() == http::verb::post &&
               path.rfind("/api/v1/driver/rides/", 0) == 0 &&
               path.size() > 7 && path.substr(path.size() - 7) == "/accept") {
        result = handle_driver_accept(request, path);
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
    stream.socket().shutdown(tcp::socket::shutdown_send, ec);
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
}

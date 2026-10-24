#include <libpq-fe.h>

#include <algorithm>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

namespace {
volatile std::sig_atomic_t stopping = 0;
void stop_worker(int) { stopping = 1; }

std::string env_or(const char* name, const char* fallback) {
    const char* value = std::getenv(name);
    return value != nullptr && *value != '\0' ? value : fallback;
}

class Result {
public:
    explicit Result(PGresult* result) : result_(result) {}
    ~Result() { if (result_ != nullptr) PQclear(result_); }
    Result(const Result&) = delete;
    Result& operator=(const Result&) = delete;
    PGresult* get() const { return result_; }
private:
    PGresult* result_;
};

void command(PGconn* db, const char* sql) {
    Result result(PQexec(db, sql));
    if (!result.get() || PQresultStatus(result.get()) != PGRES_COMMAND_OK)
        throw std::runtime_error("dispatch worker SQL command failed");
}

bool tuples(Result& result) {
    return result.get() && PQresultStatus(result.get()) == PGRES_TUPLES_OK;
}

int poll_interval_ms() {
    const std::string raw = env_or("RIDEFORGE_DISPATCH_POLL_MS", "500");
    if (raw.empty() || raw.find_first_not_of("0123456789") != std::string::npos)
        throw std::runtime_error("RIDEFORGE_DISPATCH_POLL_MS must be an integer from 100 to 5000");
    const long value = std::stol(raw);
    if (value < 100 || value > 5000)
        throw std::runtime_error("RIDEFORGE_DISPATCH_POLL_MS must be an integer from 100 to 5000");
    return static_cast<int>(value);
}

int dispatch_radius_meters() {
    const std::string raw = env_or("RIDEFORGE_DISPATCH_RADIUS_KM", "20");
    if (raw.empty() || raw.find_first_not_of("0123456789") != std::string::npos)
        throw std::runtime_error("RIDEFORGE_DISPATCH_RADIUS_KM must be an integer from 1 to 100");
    const long km = std::stol(raw);
    if (km < 1 || km > 100)
        throw std::runtime_error("RIDEFORGE_DISPATCH_RADIUS_KM must be an integer from 1 to 100");
    return static_cast<int>(km * 1000);
}

// Each pass expires stale offers, then reserves at most one eligible ride and
// its nearest never-before-tried driver in one transaction. Unique partial
// indexes are the final guard if multiple worker replicas race.
bool dispatch_one(PGconn* db, int radius_meters) {
    command(db, "BEGIN");
    try {
        command(db,
            "UPDATE ride_offers SET status='expired',responded_at=now() "
            "WHERE status='offered' AND expires_at<=now()");
        Result ride(PQexec(db,
            "SELECT r.id::text,r.pickup_latitude::text,r.pickup_longitude::text "
            "FROM rides r WHERE r.status IN ('requested','matching') AND r.driver_id IS NULL "
            "AND NOT EXISTS (SELECT 1 FROM ride_offers o WHERE o.ride_id=r.id AND o.status='offered') "
            "AND EXISTS (SELECT 1 FROM driver_profiles d WHERE d.is_approved=true AND d.is_online=true "
            "AND d.last_location_at>now()-interval '5 minutes' AND d.current_latitude IS NOT NULL "
            "AND d.current_longitude IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ride_offers tried "
            "WHERE tried.ride_id=r.id AND tried.driver_id=d.account_id) "
            "AND NOT EXISTS (SELECT 1 FROM driver_ride_declines declined "
            "WHERE declined.ride_id=r.id AND declined.driver_id=d.account_id) "
            "AND NOT EXISTS (SELECT 1 FROM rides active WHERE active.driver_id=d.account_id "
            "AND active.status IN ('assigned','driver_arriving','in_progress')) "
            "AND (6371000.0 * acos(least(1.0::double precision,greatest(-1.0::double precision,"
            "sin(radians(d.current_latitude))*sin(radians(r.pickup_latitude)) + "
            "cos(radians(d.current_latitude))*cos(radians(r.pickup_latitude))*"
            "cos(radians(r.pickup_longitude-d.current_longitude)))))) <= "
            + std::to_string(radius_meters) + ") "
            "ORDER BY r.created_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1"));
        if (!tuples(ride)) throw std::runtime_error("dispatch worker ride selection failed");
        if (PQntuples(ride.get()) == 0) {
            command(db, "COMMIT");
            return false;
        }
        const std::string ride_id = PQgetvalue(ride.get(), 0, 0);
        const std::string pickup_lat = PQgetvalue(ride.get(), 0, 1);
        const std::string pickup_lon = PQgetvalue(ride.get(), 0, 2);
        const char* params[] = {ride_id.c_str(), pickup_lat.c_str(), pickup_lon.c_str(),
                                std::to_string(radius_meters).c_str()};
        // Store the radius string for the duration of the parameterized call.
        const std::string radius = std::to_string(radius_meters);
        const char* driver_params[] = {ride_id.c_str(), pickup_lat.c_str(), pickup_lon.c_str(), radius.c_str()};
        Result driver(PQexecParams(db,
            "SELECT d.account_id::text FROM driver_profiles d "
            "WHERE d.is_approved=true AND d.is_online=true "
            "AND d.last_location_at>now()-interval '5 minutes' "
            "AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL "
            "AND NOT EXISTS (SELECT 1 FROM ride_offers tried WHERE tried.ride_id=$1::uuid AND tried.driver_id=d.account_id) "
            "AND NOT EXISTS (SELECT 1 FROM driver_ride_declines declined WHERE declined.ride_id=$1::uuid AND declined.driver_id=d.account_id) "
            "AND NOT EXISTS (SELECT 1 FROM rides active WHERE active.driver_id=d.account_id "
            "AND active.status IN ('assigned','driver_arriving','in_progress')) "
            "AND (6371000.0 * acos(least(1.0::double precision,greatest(-1.0::double precision,"
            "sin(radians(d.current_latitude))*sin(radians($2::double precision)) + "
            "cos(radians(d.current_latitude))*cos(radians($2::double precision))*"
            "cos(radians($3::double precision-d.current_longitude)))))) <= $4::double precision "
            "ORDER BY (6371000.0 * acos(least(1.0::double precision,greatest(-1.0::double precision,"
            "sin(radians(d.current_latitude))*sin(radians($2::double precision)) + "
            "cos(radians(d.current_latitude))*cos(radians($2::double precision))*"
            "cos(radians($3::double precision-d.current_longitude)))))) ASC,d.account_id "
            "FOR UPDATE OF d SKIP LOCKED LIMIT 1",
            4, nullptr, driver_params, nullptr, nullptr, 0));
        (void)params;
        if (!tuples(driver)) throw std::runtime_error("dispatch worker driver selection failed");
        if (PQntuples(driver.get()) == 0) {
            command(db, "COMMIT");
            return false;
        }
        const std::string driver_id = PQgetvalue(driver.get(), 0, 0);
        const char* offer_params[] = {ride_id.c_str(), driver_id.c_str()};
        Result inserted(PQexecParams(db,
            "INSERT INTO ride_offers (ride_id,driver_id,expires_at) "
            "VALUES ($1::uuid,$2::uuid,now()+interval '45 seconds') "
            "ON CONFLICT DO NOTHING",
            2, nullptr, offer_params, nullptr, nullptr, 0));
        if (!inserted.get() || PQresultStatus(inserted.get()) != PGRES_COMMAND_OK)
            throw std::runtime_error("dispatch worker offer insert failed");
        const bool created = std::string(PQcmdTuples(inserted.get())) == "1";
        command(db, "COMMIT");
        if (created)
            std::cout << "{\"event\":\"driver_offer_created\",\"rideId\":\"" << ride_id
                      << "\",\"driverId\":\"" << driver_id << "\"}" << std::endl;
        return created;
    } catch (...) {
        PGresult* rollback = PQexec(db, "ROLLBACK");
        if (rollback) PQclear(rollback);
        throw;
    }
}
} // namespace

int main() {
    std::signal(SIGINT, stop_worker);
    std::signal(SIGTERM, stop_worker);
    try {
        const int interval = poll_interval_ms();
        const int radius = dispatch_radius_meters();
        while (!stopping) {
            PGconn* db = PQconnectdb(env_or("DATABASE_URL", "").c_str());
            if (!db || PQstatus(db) != CONNECTION_OK) {
                if (db) PQfinish(db);
                std::cerr << "{\"event\":\"dispatch_worker_database_unavailable\"}" << std::endl;
                std::this_thread::sleep_for(std::chrono::seconds(2));
                continue;
            }
            try {
                const bool dispatched = dispatch_one(db, radius);
                PQfinish(db);
                if (!dispatched) std::this_thread::sleep_for(std::chrono::milliseconds(interval));
            } catch (const std::exception&) {
                PQfinish(db);
                std::cerr << "{\"event\":\"dispatch_worker_iteration_failed\"}" << std::endl;
                std::this_thread::sleep_for(std::chrono::seconds(1));
            }
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << std::endl;
        return 2;
    }
    return 0;
}

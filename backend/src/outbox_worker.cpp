#include <libpq-fe.h>
#include <nlohmann/json.hpp>

#include <chrono>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

using json = nlohmann::json;

namespace {
volatile std::sig_atomic_t shutdown_requested = 0;

void request_shutdown(int) {
    shutdown_requested = 1;
}

std::string env_or(const char* name, const char* fallback = "") {
    const char* value = std::getenv(name);
    return value != nullptr && *value != '\0' ? value : fallback;
}

class Result {
public:
    explicit Result(PGresult* result) : value_(result) {}
    ~Result() { if (value_ != nullptr) PQclear(value_); }
    Result(const Result&) = delete;
    Result& operator=(const Result&) = delete;
    PGresult* get() const { return value_; }
private:
    PGresult* value_;
};

void require_command(PGconn* connection, const char* sql) {
    Result result(PQexec(connection, sql));
    if (result.get() == nullptr || PQresultStatus(result.get()) != PGRES_COMMAND_OK) {
        throw std::runtime_error(result.get() == nullptr ? PQerrorMessage(connection)
                                                        : PQresultErrorMessage(result.get()));
    }
}

bool publish_one(PGconn* connection) {
    std::string outbox_id, event_id, ride_id, status, created_at;
    int attempts = 0;
    require_command(connection, "BEGIN");
    try {
        Result event(PQexec(connection,
            "SELECT o.id::text,o.ride_event_id::text,o.ride_id::text,e.new_status::text,e.created_at::text "
            "FROM ride_event_outbox o JOIN ride_events e ON e.id=o.ride_event_id "
            "WHERE o.published_at IS NULL AND o.dead_lettered_at IS NULL AND o.available_at<=now() "
            "AND (o.claimed_until IS NULL OR o.claimed_until<now()) "
            "ORDER BY o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1"));
        if (event.get() == nullptr || PQresultStatus(event.get()) != PGRES_TUPLES_OK)
            throw std::runtime_error("outbox_select_failed");
        if (PQntuples(event.get()) == 0) {
            require_command(connection, "COMMIT");
            return false;
        }
        outbox_id = PQgetvalue(event.get(), 0, 0);
        event_id = PQgetvalue(event.get(), 0, 1);
        ride_id = PQgetvalue(event.get(), 0, 2);
        status = PQgetvalue(event.get(), 0, 3);
        created_at = PQgetvalue(event.get(), 0, 4);
        const char* values[] = {outbox_id.c_str()};
        Result claimed(PQexecParams(connection,
            "UPDATE ride_event_outbox SET attempts=attempts+1,claimed_until=now()+interval '30 seconds' "
            "WHERE id=$1::bigint RETURNING attempts::text", 1, nullptr, values, nullptr, nullptr, 0));
        if (claimed.get() == nullptr || PQresultStatus(claimed.get()) != PGRES_TUPLES_OK ||
            PQntuples(claimed.get()) != 1) throw std::runtime_error("outbox_claim_failed");
        attempts = std::stoi(PQgetvalue(claimed.get(), 0, 0));
        require_command(connection, "COMMIT");
    } catch (...) {
        Result rollback(PQexec(connection, "ROLLBACK"));
        throw;
    }

    try {
        require_command(connection, "BEGIN");
        const std::string payload = json{{"eventId", std::stoull(event_id)}, {"rideId", ride_id},
            {"status", status}, {"createdAt", created_at}}.dump();
        const char* values[] = {payload.c_str()};
        Result notified(PQexecParams(connection, "SELECT pg_notify('rideforge_ride_events',$1)",
            1, nullptr, values, nullptr, nullptr, 0));
        if (notified.get() == nullptr || PQresultStatus(notified.get()) != PGRES_TUPLES_OK)
            throw std::runtime_error("outbox_notify_failed");
        const char* update_values[] = {outbox_id.c_str()};
        Result marked(PQexecParams(connection,
            "UPDATE ride_event_outbox SET published_at=now(),claimed_until=NULL,last_error=NULL "
            "WHERE id=$1::bigint AND published_at IS NULL",
            1, nullptr, update_values, nullptr, nullptr, 0));
        if (marked.get() == nullptr || PQresultStatus(marked.get()) != PGRES_COMMAND_OK ||
            std::string(PQcmdTuples(marked.get())) != "1")
            throw std::runtime_error("outbox_mark_failed");
        require_command(connection, "COMMIT");
        std::cout << "{\"event\":\"ride_event_published\",\"eventId\":" << event_id
                  << ",\"attempt\":" << attempts << "}\n";
        return true;
    } catch (...) {
        Result rollback(PQexec(connection, "ROLLBACK"));
        if (PQstatus(connection) != CONNECTION_OK) throw std::runtime_error("database_disconnected");
        const char* values[] = {outbox_id.c_str()};
        Result failed(PQexecParams(connection,
            "UPDATE ride_event_outbox SET claimed_until=NULL,last_error='publish_failed',"
            "dead_lettered_at=CASE WHEN attempts>=10 THEN now() ELSE NULL END,"
            "available_at=CASE WHEN attempts>=10 THEN available_at ELSE now()+"
            "make_interval(secs=>LEAST(300,power(2,LEAST(attempts,8))::integer)) END "
            "WHERE id=$1::bigint AND published_at IS NULL",
            1, nullptr, values, nullptr, nullptr, 0));
        if (failed.get() == nullptr || PQresultStatus(failed.get()) != PGRES_COMMAND_OK)
            throw std::runtime_error("outbox_retry_schedule_failed");
        std::cerr << "{\"event\":\"ride_event_delivery_failed\",\"eventId\":" << event_id
                  << ",\"attempt\":" << attempts
                  << ",\"deadLettered\":" << (attempts >= 10 ? "true" : "false") << "}\n";
        return true;
    }
}
} // namespace

int main() {
    const std::string database_url = env_or("DATABASE_URL");
    if (database_url.empty()) {
        std::cerr << "DATABASE_URL is required\n";
        return 2;
    }
    const int poll_ms = std::stoi(env_or("RIDEFORGE_OUTBOX_POLL_MS", "250"));
    if (poll_ms < 50 || poll_ms > 5000) {
        std::cerr << "RIDEFORGE_OUTBOX_POLL_MS must be between 50 and 5000\n";
        return 2;
    }

    std::signal(SIGINT, request_shutdown);
    std::signal(SIGTERM, request_shutdown);

    while (!shutdown_requested) {
        PGconn* connection = PQconnectdb(database_url.c_str());
        if (connection == nullptr || PQstatus(connection) != CONNECTION_OK) {
            std::cerr << "{\"event\":\"outbox_database_unavailable\"}\n";
            if (connection != nullptr) PQfinish(connection);
            std::this_thread::sleep_for(std::chrono::seconds(2));
            continue;
        }
        bool reconnect = false;
        while (!reconnect && !shutdown_requested) {
            try {
                if (!publish_one(connection)) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(poll_ms));
                }
            } catch (const std::exception&) {
                // Avoid writing raw database/provider exception text to logs.
                std::cerr << "{\"event\":\"outbox_publish_failed\"}\n";
                if (PQstatus(connection) != CONNECTION_OK) reconnect = true;
                else std::this_thread::sleep_for(std::chrono::seconds(1));
            }
        }
        PQfinish(connection);
    }
    std::cerr << "{\"event\":\"outbox_worker_shutdown\"}\n";
    return 0;
}

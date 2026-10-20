http::response<http::string_body> handle_driver_history(
    const http::request<http::string_body>& request) {
    const auto claims = bearer_claims(request);
    if (!claims) return response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
    if (claims->role != "driver") return response(http::status::forbidden, {{"error", "driver_role_required"}}, request);

    PGconn* connection = PQconnectdb(env_or("DATABASE_URL", "").c_str());
    if (connection == nullptr || PQstatus(connection) != CONNECTION_OK) {
        if (connection != nullptr) PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "driver_history_unavailable"}}, request);
    }
    const char* params[] = {claims->subject.c_str()};
    PGresult* result = PQexecParams(connection,
        "SELECT id::text,status::text,pickup_label,destination_label,quoted_fare_paise::text,"
        "final_fare_paise::text,created_at::text,completed_at::text "
        "FROM rides WHERE driver_id=$1::uuid "
        "ORDER BY created_at DESC LIMIT 50",
        1, nullptr, params, nullptr, nullptr, 0);
    if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
        if (result != nullptr) PQclear(result);
        PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "driver_history_unavailable"}}, request);
    }
    json rides = json::array();
    for (int row = 0; row < PQntuples(result); ++row) {
        json ride{{"rideId", PQgetvalue(result, row, 0)}, {"status", PQgetvalue(result, row, 1)},
            {"pickup", PQgetvalue(result, row, 2)}, {"destination", PQgetvalue(result, row, 3)},
            {"farePaise", std::stoi(PQgetvalue(result, row, 4))}, {"currency", "INR"},
            {"createdAt", PQgetvalue(result, row, 6)}};
        if (!PQgetisnull(result, row, 5)) ride["finalFarePaise"] = std::stoi(PQgetvalue(result, row, 5));
        if (!PQgetisnull(result, row, 7)) ride["completedAt"] = PQgetvalue(result, row, 7);
        rides.push_back(std::move(ride));
    }
    PQclear(result);
    PGresult* total = PQexecParams(connection,
        "SELECT COALESCE(sum(COALESCE(final_fare_paise,quoted_fare_paise)),0)::text "
        "FROM rides WHERE driver_id=$1::uuid AND status='completed'",
        1, nullptr, params, nullptr, nullptr, 0);
    if (total == nullptr || PQresultStatus(total) != PGRES_TUPLES_OK || PQntuples(total) != 1) {
        if (total != nullptr) PQclear(total);
        PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "driver_history_unavailable"}}, request);
    }
    const long long gross_completed_fare = std::stoll(PQgetvalue(total, 0, 0));
    PQclear(total);
    PQfinish(connection);
    return response(http::status::ok, {{"rides", rides}, {"grossCompletedFarePaise", gross_completed_fare},
        {"currency", "INR"}, {"note", "Gross completed fares only; this is not a payout or net-earnings ledger."}}, request);
}

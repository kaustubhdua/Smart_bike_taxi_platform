http::response<http::string_body> handle_driver_queue(
    const http::request<http::string_body>& request) {
    const auto claims = bearer_claims(request);
    if (!claims) {
        return response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
    }
    if (claims->role != "driver") {
        return response(http::status::forbidden, {{"error", "driver_role_required"}}, request);
    }
    PGconn* connection = PQconnectdb(env_or("DATABASE_URL", "").c_str());
    if (connection == nullptr || PQstatus(connection) != CONNECTION_OK) {
        if (connection != nullptr) PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "driver_queue_unavailable"}}, request);
    }
    const char* params[] = {claims->subject.c_str()};
    PGresult* result = PQexecParams(connection,
        "SELECT r.id::text,r.pickup_label,r.destination_label,r.route_distance_m::text,"
        "r.quoted_fare_paise::text,r.created_at::text FROM rides r "
        "WHERE r.status IN ('requested','matching') AND r.driver_id IS NULL "
        "AND EXISTS (SELECT 1 FROM driver_profiles d WHERE d.account_id=$1::uuid "
        "AND d.is_approved=true AND d.is_online=true "
        "AND d.last_location_at>now()-interval '5 minutes') "
        "ORDER BY r.created_at ASC LIMIT 20",
        1, nullptr, params, nullptr, nullptr, 0);
    if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
        if (result != nullptr) PQclear(result);
        PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "driver_queue_unavailable"}}, request);
    }
    json rides = json::array();
    for (int i = 0; i < PQntuples(result); ++i) {
        rides.push_back({{"rideId", PQgetvalue(result, i, 0)},
            {"pickup", PQgetvalue(result, i, 1)}, {"destination", PQgetvalue(result, i, 2)},
            {"distanceMeters", std::stoi(PQgetvalue(result, i, 3))},
            {"farePaise", std::stoi(PQgetvalue(result, i, 4))},
            {"createdAt", PQgetvalue(result, i, 5)}});
    }
    PQclear(result);
    PQfinish(connection);
    return response(http::status::ok, {{"rides", rides}}, request);
}

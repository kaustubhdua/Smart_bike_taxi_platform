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
    PGresult* result = PQexec(connection,
        "SELECT id::text,pickup_label,destination_label,route_distance_m::text,"
        "quoted_fare_paise::text,created_at::text FROM rides "
        "WHERE status IN ('requested','matching') ORDER BY created_at ASC LIMIT 20");
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

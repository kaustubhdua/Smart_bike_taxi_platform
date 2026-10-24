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
    const std::string radius_meters = std::to_string(dispatch_radius_meters());
    const char* params[] = {claims->subject.c_str(), radius_meters.c_str()};
    PGresult* result = PQexecParams(connection,
        "WITH eligible AS ("
        "SELECT r.id::text AS ride_id,r.pickup_label,r.destination_label,"
        "r.route_distance_m::text AS route_distance_m,r.quoted_fare_paise::text AS fare_paise,"
        "r.created_at::text AS created_at,offer.expires_at::text AS offer_expires_at,"
        "(6371000.0 * acos(least(1.0::double precision,greatest(-1.0::double precision,"
        "sin(radians(d.current_latitude))*sin(radians(r.pickup_latitude)) + "
        "cos(radians(d.current_latitude))*cos(radians(r.pickup_latitude))*"
        "cos(radians(r.pickup_longitude-d.current_longitude)))))) AS pickup_distance_m "
        "FROM rides r JOIN ride_offers offer ON offer.ride_id=r.id AND offer.driver_id=$1::uuid "
        "AND offer.status='offered' AND offer.expires_at>now() "
        "JOIN driver_profiles d ON d.account_id=$1::uuid "
        "WHERE r.status IN ('requested','matching') AND r.driver_id IS NULL "
        "AND d.is_approved=true AND d.is_online=true "
        "AND d.last_location_at>now()-interval '5 minutes' "
        "AND d.current_latitude IS NOT NULL AND d.current_longitude IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM driver_ride_declines declined "
        "WHERE declined.ride_id=r.id AND declined.driver_id=d.account_id) "
        "AND NOT EXISTS (SELECT 1 FROM rides active WHERE active.driver_id=d.account_id "
        "AND active.status IN ('assigned','driver_arriving','in_progress'))) "
        "SELECT ride_id,pickup_label,destination_label,route_distance_m,fare_paise,created_at,offer_expires_at,"
        "pickup_distance_m::integer FROM eligible WHERE pickup_distance_m<=$2::double precision "
        "ORDER BY pickup_distance_m ASC,created_at ASC LIMIT 20",
        2, nullptr, params, nullptr, nullptr, 0);
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
            {"createdAt", PQgetvalue(result, i, 5)},
            {"offerExpiresAt", PQgetvalue(result, i, 6)},
            {"pickupDistanceMeters", std::stoi(PQgetvalue(result, i, 7))}});
    }
    PQclear(result);
    PQfinish(connection);
    return response(http::status::ok, {{"rides", rides}}, request);
}

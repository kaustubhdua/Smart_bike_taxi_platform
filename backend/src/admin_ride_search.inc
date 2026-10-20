std::string decode_admin_query_component(std::string_view encoded) {
    std::string decoded;
    decoded.reserve(encoded.size());
    const auto hex_value = [](char ch) -> int {
        if (ch >= '0' && ch <= '9') return ch - '0';
        if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
        if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
        return -1;
    };
    for (std::size_t i = 0; i < encoded.size(); ++i) {
        unsigned char ch = static_cast<unsigned char>(encoded[i]);
        if (ch == '+') {
            decoded.push_back(' ');
        } else if (ch == '%') {
            if (i + 2 >= encoded.size()) throw std::invalid_argument("Invalid query encoding");
            const int high = hex_value(encoded[i + 1]);
            const int low = hex_value(encoded[i + 2]);
            if (high < 0 || low < 0) throw std::invalid_argument("Invalid query encoding");
            ch = static_cast<unsigned char>((high << 4) | low);
            i += 2;
            if (ch < 0x20 || ch == 0x7f) throw std::invalid_argument("Invalid query encoding");
            decoded.push_back(static_cast<char>(ch));
        } else {
            if (ch < 0x20 || ch == 0x7f) throw std::invalid_argument("Invalid query encoding");
            decoded.push_back(static_cast<char>(ch));
        }
        if (decoded.size() > 256) throw std::invalid_argument("Query value too long");
    }
    return decoded;
}

std::map<std::string, std::string> admin_query_params(const std::string& path) {
    std::map<std::string, std::string> params;
    const auto question = path.find('?');
    if (question == std::string::npos) return params;
    std::string_view query(path.data() + question + 1, path.size() - question - 1);
    while (!query.empty()) {
        const auto ampersand = query.find('&');
        const std::string_view pair = query.substr(0, ampersand);
        const auto equals = pair.find('=');
        const auto key = decode_admin_query_component(pair.substr(0, equals));
        const auto value = equals == std::string_view::npos
            ? std::string() : decode_admin_query_component(pair.substr(equals + 1));
        if (key.empty() || !params.emplace(key, value).second || params.size() > 4) {
            throw std::invalid_argument("Invalid query parameters");
        }
        if (ampersand == std::string_view::npos) break;
        query.remove_prefix(ampersand + 1);
    }
    return params;
}

http::response<http::string_body> handle_admin_ride_search(
    const http::request<http::string_body>& request, const std::string& path) {
    const auto claims = bearer_claims(request);
    if (!claims) return response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
    if (claims->role != "admin") return response(http::status::forbidden, {{"error", "admin_role_required"}}, request);

    std::string query;
    std::string status;
    try {
        const auto params = admin_query_params(path);
        for (const auto& item : params) {
            if (item.first != "q" && item.first != "status") {
                return response(http::status::bad_request, {{"error", "unsupported_search_parameter"}}, request);
            }
        }
        if (const auto it = params.find("q"); it != params.end()) query = it->second;
        if (const auto it = params.find("status"); it != params.end()) status = it->second;
    } catch (const std::invalid_argument&) {
        return response(http::status::bad_request, {{"error", "invalid_search_query"}}, request);
    }
    if (query.size() > 160) return response(http::status::bad_request, {{"error", "search_query_too_long"}}, request);
    const std::vector<std::string> statuses = {
        "requested", "matching", "assigned", "driver_arriving", "in_progress", "completed", "cancelled", "failed"
    };
    if (!status.empty() && std::find(statuses.begin(), statuses.end(), status) == statuses.end()) {
        return response(http::status::bad_request, {{"error", "invalid_ride_status_filter"}}, request);
    }

    PGconn* connection = PQconnectdb(env_or("DATABASE_URL", "").c_str());
    if (connection == nullptr || PQstatus(connection) != CONNECTION_OK) {
        if (connection != nullptr) PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "ride_search_unavailable"}}, request);
    }
    const char* params[] = {query.c_str(), status.c_str()};
    PGresult* result = PQexecParams(connection,
        "SELECT r.id::text,r.status::text,p.email,COALESCE(d.email,''),r.pickup_label,r.destination_label,"
        "COALESCE(r.final_fare_paise,r.quoted_fare_paise)::text,r.created_at::text,r.updated_at::text "
        "FROM rides r JOIN accounts p ON p.id=r.passenger_id "
        "LEFT JOIN accounts d ON d.id=r.driver_id "
        "WHERE ($1='' OR position(lower($1) in lower(r.id::text))>0 "
        "OR position(lower($1) in lower(p.email))>0 OR position(lower($1) in lower(COALESCE(d.email,'')))>0 "
        "OR position(lower($1) in lower(r.pickup_label))>0 OR position(lower($1) in lower(r.destination_label))>0) "
        "AND ($2='' OR r.status::text=$2) ORDER BY r.created_at DESC LIMIT 100",
        2, nullptr, params, nullptr, nullptr, 0);
    if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
        if (result != nullptr) PQclear(result);
        PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "ride_search_unavailable"}}, request);
    }
    json rides = json::array();
    for (int row = 0; row < PQntuples(result); ++row) {
        rides.push_back({{"rideId", PQgetvalue(result, row, 0)}, {"status", PQgetvalue(result, row, 1)},
            {"passengerEmail", PQgetvalue(result, row, 2)},
            {"driverEmail", std::string(PQgetvalue(result, row, 3)).empty()
                ? json(nullptr) : json(PQgetvalue(result, row, 3))},
            {"pickup", PQgetvalue(result, row, 4)}, {"destination", PQgetvalue(result, row, 5)},
            {"farePaise", std::stoll(PQgetvalue(result, row, 6))},
            {"createdAt", PQgetvalue(result, row, 7)}, {"updatedAt", PQgetvalue(result, row, 8)}});
    }
    PQclear(result);
    PQfinish(connection);
    return response(http::status::ok, {{"rides", rides}, {"limit", 100}}, request);
}

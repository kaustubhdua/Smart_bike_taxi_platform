// Authenticated support reports and admin-only resolution workflow.
namespace {
using support_json = nlohmann::json;

bool valid_support_uuid(const std::string& value) {
    if (value.size() != 36) return false;
    for (std::size_t i = 0; i < value.size(); ++i) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (value[i] != '-') return false;
        } else if (!std::isxdigit(static_cast<unsigned char>(value[i]))) {
            return false;
        }
    }
    return true;
}

support_json support_row(PGresult* result, int row, bool include_reporter) {
    support_json value = {
        {"id", PQgetvalue(result, row, 0)},
        {"rideId", PQgetisnull(result, row, 1) ? support_json(nullptr) : support_json(PQgetvalue(result, row, 1))},
        {"category", PQgetvalue(result, row, 2)},
        {"description", PQgetvalue(result, row, 3)},
        {"status", PQgetvalue(result, row, 4)},
        {"resolutionNote", PQgetvalue(result, row, 5)},
        {"createdAt", PQgetvalue(result, row, 6)},
        {"updatedAt", PQgetvalue(result, row, 7)},
        {"resolvedAt", PQgetisnull(result, row, 8) ? support_json(nullptr) : support_json(PQgetvalue(result, row, 8))}
    };
    if (include_reporter) {
        value["reporterId"] = PQgetvalue(result, row, 9);
        value["reporterEmail"] = PQgetvalue(result, row, 10);
        value["reporterName"] = PQgetvalue(result, row, 11);
    }
    return value;
}

http::response<http::string_body> handle_support_reports(
    const http::request<http::string_body>& request, const std::string& path) {
    const auto claims = bearer_claims(request);
    if (!claims) return response(http::status::unauthorized, {{"error", "authentication_required"}}, request);

    const bool admin_list = request.method() == http::verb::get && path == "/api/v1/admin/support-reports";
    const bool user_list = request.method() == http::verb::get && path == "/api/v1/support/reports";
    const bool user_create = request.method() == http::verb::post && path == "/api/v1/support/reports";
    constexpr std::string_view admin_prefix = "/api/v1/admin/support-reports/";
    const bool admin_update = request.method() == http::verb::put &&
        path.rfind(admin_prefix, 0) == 0 && path.size() > admin_prefix.size();

    if (!admin_list && !user_list && !user_create && !admin_update) {
        return response(http::status::not_found, {{"error", "not_found"}}, request);
    }
    if (admin_list || admin_update) {
        if (claims->role != "admin") return response(http::status::forbidden, {{"error", "admin_role_required"}}, request);
    } else if (claims->role != "passenger" && claims->role != "driver") {
        return response(http::status::forbidden, {{"error", "passenger_or_driver_role_required"}}, request);
    }

    PGconn* connection = PQconnectdb(env_or("DATABASE_URL", "").c_str());
    if (connection == nullptr || PQstatus(connection) != CONNECTION_OK) {
        if (connection != nullptr) PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "support_unavailable"}}, request);
    }

    if (user_list || admin_list) {
        const char* params[] = {claims->subject.c_str()};
        const char* sql = admin_list
            ? "SELECT s.id::text,s.ride_id::text,s.category,s.description,s.status,s.resolution_note,"
              "s.created_at::text,s.updated_at::text,s.resolved_at::text,s.reporter_id::text,a.email,a.display_name "
              "FROM support_reports s JOIN accounts a ON a.id=s.reporter_id "
              "ORDER BY s.created_at DESC,s.id DESC LIMIT 100"
            : "SELECT s.id::text,s.ride_id::text,s.category,s.description,s.status,s.resolution_note,"
              "s.created_at::text,s.updated_at::text,s.resolved_at::text "
              "FROM support_reports s WHERE s.reporter_id=$1::uuid "
              "ORDER BY s.created_at DESC,s.id DESC LIMIT 100";
        PGresult* result = PQexecParams(connection, sql, admin_list ? 0 : 1, nullptr,
            admin_list ? nullptr : params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK) {
            if (result != nullptr) PQclear(result);
            PQfinish(connection);
            return response(http::status::service_unavailable, {{"error", "support_unavailable"}}, request);
        }
        support_json reports = support_json::array();
        for (int row = 0; row < PQntuples(result); ++row) reports.push_back(support_row(result, row, admin_list));
        PQclear(result);
        PQfinish(connection);
        return response(http::status::ok, {{"reports", reports}}, request);
    }

    if (user_create) {
        support_json body;
        try {
            body = support_json::parse(request.body());
        } catch (...) {
            PQfinish(connection);
            return response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
        }
        if (!body.is_object() || !body.contains("category") || !body["category"].is_string() ||
            !body.contains("description") || !body["description"].is_string()) {
            PQfinish(connection);
            return response(http::status::unprocessable_entity, {{"error", "category_and_description_required"}}, request);
        }
        const std::string category = body["category"].get<std::string>();
        const std::string description = body["description"].get<std::string>();
        const std::vector<std::string> categories = {"booking", "driver", "payment", "safety", "technical", "other"};
        if (std::find(categories.begin(), categories.end(), category) == categories.end() ||
            description.size() < 10 || description.size() > 2000 ||
            description.find_first_not_of(" \t\r\n") == std::string::npos) {
            PQfinish(connection);
            return response(http::status::unprocessable_entity, {{"error", "invalid_support_report"}}, request);
        }
        std::string ride_id;
        if (body.contains("rideId") && !body["rideId"].is_null()) {
            if (!body["rideId"].is_string()) {
                PQfinish(connection);
                return response(http::status::unprocessable_entity, {{"error", "invalid_ride_id"}}, request);
            }
            ride_id = body["rideId"].get<std::string>();
            if (!valid_support_uuid(ride_id)) {
                PQfinish(connection);
                return response(http::status::unprocessable_entity, {{"error", "invalid_ride_id"}}, request);
            }
            const char* ride_params[] = {ride_id.c_str(), claims->role.c_str(), claims->subject.c_str()};
            PGresult* owned = PQexecParams(connection,
                "SELECT 1 FROM rides WHERE id=$1::uuid AND "
                "(($2='passenger' AND passenger_id=$3::uuid) OR ($2='driver' AND driver_id=$3::uuid))",
                3, nullptr, ride_params, nullptr, nullptr, 0);
            if (owned == nullptr || PQresultStatus(owned) != PGRES_TUPLES_OK) {
                if (owned != nullptr) PQclear(owned);
                PQfinish(connection);
                return response(http::status::service_unavailable, {{"error", "support_unavailable"}}, request);
            }
            const bool participant = PQntuples(owned) == 1;
            PQclear(owned);
            if (!participant) {
                PQfinish(connection);
                return response(http::status::not_found, {{"error", "ride_not_found"}}, request);
            }
        }
        const char* params[] = {claims->subject.c_str(), ride_id.c_str(), category.c_str(), description.c_str()};
        PGresult* inserted = PQexecParams(connection,
            "INSERT INTO support_reports (reporter_id,ride_id,category,description) "
            "VALUES ($1::uuid,NULLIF($2,'')::uuid,$3,$4) "
            "RETURNING id::text,ride_id::text,category,description,status,resolution_note,"
            "created_at::text,updated_at::text,resolved_at::text",
            4, nullptr, params, nullptr, nullptr, 0);
        if (inserted == nullptr || PQresultStatus(inserted) != PGRES_TUPLES_OK || PQntuples(inserted) != 1) {
            if (inserted != nullptr) PQclear(inserted);
            PQfinish(connection);
            return response(http::status::service_unavailable, {{"error", "support_unavailable"}}, request);
        }
        const auto report = support_row(inserted, 0, false);
        PQclear(inserted);
        PQfinish(connection);
        return response(http::status::created, report, request);
    }

    // Admin resolution: status transitions and the audit record commit together.
    const std::string id = path.substr(admin_prefix.size());
    if (id.empty() || !std::all_of(id.begin(), id.end(), [](unsigned char ch) { return std::isdigit(ch) != 0; })) {
        PQfinish(connection);
        return response(http::status::unprocessable_entity, {{"error", "invalid_report_id"}}, request);
    }
    support_json body;
    try {
        body = support_json::parse(request.body());
    } catch (...) {
        PQfinish(connection);
        return response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
    }
    if (!body.is_object() || !body.contains("status") || !body["status"].is_string()) {
        PQfinish(connection);
        return response(http::status::unprocessable_entity, {{"error", "status_required"}}, request);
    }
    const std::string status = body["status"].get<std::string>();
    std::string resolution_note;
    if (body.contains("resolutionNote")) {
        if (!body["resolutionNote"].is_string()) {
            PQfinish(connection);
            return response(http::status::unprocessable_entity, {{"error", "invalid_resolution_note"}}, request);
        }
        resolution_note = body["resolutionNote"].get<std::string>();
    }
    if ((status != "in_review" && status != "resolved" && status != "rejected") ||
        resolution_note.size() > 2000 ||
        ((status == "resolved" || status == "rejected") &&
         (resolution_note.size() < 10 || resolution_note.find_first_not_of(" \t\r\n") == std::string::npos))) {
        PQfinish(connection);
        return response(http::status::unprocessable_entity, {{"error", "invalid_report_resolution"}}, request);
    }
    PGresult* begun = PQexec(connection, "BEGIN");
    if (begun == nullptr || PQresultStatus(begun) != PGRES_COMMAND_OK) {
        if (begun != nullptr) PQclear(begun);
        PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "support_unavailable"}}, request);
    }
    PQclear(begun);
    const char* update_params[] = {id.c_str(), status.c_str(), resolution_note.c_str(), claims->subject.c_str()};
    PGresult* updated = PQexecParams(connection,
        "UPDATE support_reports SET status=$2,resolution_note=$3,"
        "resolved_by=CASE WHEN $2 IN ('resolved','rejected') THEN $4::uuid ELSE NULL END,"
        "resolved_at=CASE WHEN $2 IN ('resolved','rejected') THEN now() ELSE NULL END,updated_at=now() "
        "WHERE id=$1::bigint AND status IN ('open','in_review') "
        "RETURNING id::text,ride_id::text,category,description,status,resolution_note,"
        "created_at::text,updated_at::text,resolved_at::text",
        4, nullptr, update_params, nullptr, nullptr, 0);
    if (updated == nullptr || PQresultStatus(updated) != PGRES_TUPLES_OK || PQntuples(updated) != 1) {
        if (updated != nullptr) PQclear(updated);
        PGresult* rollback = PQexec(connection, "ROLLBACK");
        if (rollback != nullptr) PQclear(rollback);
        PQfinish(connection);
        return response(http::status::conflict, {{"error", "report_not_open"}}, request);
    }
    const auto report = support_row(updated, 0, false);
    PQclear(updated);
    const support_json details = {{"status", status}};
    const std::string details_text = details.dump();
    const char* audit_params[] = {claims->subject.c_str(), id.c_str(), details_text.c_str()};
    PGresult* audit = PQexecParams(connection,
        "INSERT INTO admin_audit_events (actor_id,action,target_type,target_id,details) "
        "VALUES ($1::uuid,'support_report.status_changed','support_report',$2,$3::jsonb)",
        3, nullptr, audit_params, nullptr, nullptr, 0);
    if (audit == nullptr || PQresultStatus(audit) != PGRES_COMMAND_OK) {
        if (audit != nullptr) PQclear(audit);
        PGresult* rollback = PQexec(connection, "ROLLBACK");
        if (rollback != nullptr) PQclear(rollback);
        PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "support_unavailable"}}, request);
    }
    PQclear(audit);
    PGresult* committed = PQexec(connection, "COMMIT");
    if (committed == nullptr || PQresultStatus(committed) != PGRES_COMMAND_OK) {
        if (committed != nullptr) PQclear(committed);
        PQfinish(connection);
        return response(http::status::service_unavailable, {{"error", "support_unavailable"}}, request);
    }
    PQclear(committed);
    PQfinish(connection);
    return response(http::status::ok, report, request);
}
} // namespace

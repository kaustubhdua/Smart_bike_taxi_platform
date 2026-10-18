http::response<http::string_body> handle_driver_status(
    const http::request<http::string_body>& request, const std::string& path) {
    const auto claims = bearer_claims(request);
    if (!claims || claims->role != "driver") {
        return response(http::status::forbidden, {{"error", "driver_auth_required"}}, request);
    }
    const std::string prefix = "/api/v1/driver/rides/";
    if (path.size() <= prefix.size() + 7) {
        return response(http::status::unprocessable_entity, {{"error", "ride_id_required"}}, request);
    }
    const std::string ride_id = path.substr(prefix.size(), path.size() - prefix.size() - 7);
    try {
        const auto body = json::parse(request.body());
        if (!body.is_object() || !body.contains("status") || !body["status"].is_string()) {
            return response(http::status::unprocessable_entity, {{"error", "status_required"}}, request);
        }
        const std::string next = body["status"].get<std::string>();
        if (next != "driver_arriving" && next != "in_progress" && next != "completed") {
            return response(http::status::unprocessable_entity, {{"error", "unsupported_status"}}, request);
        }
        Database database(env_or("DATABASE_URL", ""));
        return response(http::status::ok, database.advance_ride(ride_id, claims->subject, next), request);
    } catch (const std::domain_error& error) {
        return response(http::status::conflict, {{"error", error.what()}}, request);
    } catch (const json::exception&) {
        return response(http::status::unprocessable_entity, {{"error", "invalid_json"}}, request);
    } catch (const std::exception&) {
        return response(http::status::service_unavailable, {{"error", "driver_operation_unavailable"}}, request);
    }
}

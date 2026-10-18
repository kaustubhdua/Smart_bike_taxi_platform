http::response<http::string_body> handle_driver_accept(
    const http::request<http::string_body>& request, const std::string& path) {
    const auto claims = bearer_claims(request);
    if (!claims) {
        return response(http::status::unauthorized, {{"error", "authentication_required"}}, request);
    }
    if (claims->role != "driver") {
        return response(http::status::forbidden, {{"error", "driver_role_required"}}, request);
    }
    const std::string prefix = "/api/v1/driver/rides/";
    if (path.size() <= prefix.size() + 7) {
        return response(http::status::unprocessable_entity, {{"error", "ride_id_required"}}, request);
    }
    const std::string ride_id = path.substr(prefix.size(), path.size() - prefix.size() - 7);
    try {
        Database database(env_or("DATABASE_URL", ""));
        return response(http::status::ok, database.accept_ride(ride_id, claims->subject), request);
    } catch (const std::domain_error& error) {
        return response(http::status::conflict, {{"error", error.what()}}, request);
    } catch (const std::exception&) {
        return response(http::status::service_unavailable, {{"error", "driver_operation_unavailable"}}, request);
    }
}

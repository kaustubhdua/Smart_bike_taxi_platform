#include <libpq-fe.h>
#include "security.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {
std::string trim(std::string value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}
}

int main(int argc, char** argv) {
    if (argc != 3) {
        std::cerr << "Usage: rideforge_admin_bootstrap <email> <display-name> (password is read from stdin)\n";
        return 2;
    }
    const char* database_url = std::getenv("DATABASE_URL");
    if (database_url == nullptr || *database_url == '\0') {
        std::cerr << "DATABASE_URL is required\n";
        return 2;
    }

    std::string email = trim(argv[1]);
    std::transform(email.begin(), email.end(), email.begin(),
        [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    const std::string name = trim(argv[2]);
    std::string password;
    if (!std::getline(std::cin, password)) {
        std::cerr << "Read password from stdin failed\n";
        return 2;
    }
    if (email.empty() || email.size() > 254 || email.find('@') == std::string::npos ||
        name.empty() || name.size() > 120 || password.size() < 12 || password.size() > 128) {
        std::cerr << "A valid email, 1-120 character name and 12-128 character password are required\n";
        return 2;
    }

    try {
        const std::string hash = saarthi_security::password_hash(password);
        std::fill(password.begin(), password.end(), '\0');
        PGconn* connection = PQconnectdb(database_url);
        if (connection == nullptr || PQstatus(connection) != CONNECTION_OK) {
            if (connection != nullptr) PQfinish(connection);
            throw std::runtime_error("Database connection failed");
        }
        const char* params[] = {email.c_str(), name.c_str(), hash.c_str()};
        PGresult* result = PQexecParams(connection,
            "INSERT INTO accounts (email,display_name,role,password_hash) "
            "VALUES ($1,$2,'admin',$3) RETURNING id::text",
            3, nullptr, params, nullptr, nullptr, 0);
        if (result == nullptr || PQresultStatus(result) != PGRES_TUPLES_OK ||
            PQntuples(result) != 1) {
            const char* state = result == nullptr ? nullptr : PQresultErrorField(result, PG_DIAG_SQLSTATE);
            const bool duplicate = state != nullptr && std::string(state) == "23505";
            if (result != nullptr) PQclear(result);
            PQfinish(connection);
            throw std::runtime_error(duplicate ? "Account email already exists; refusing to change an existing account"
                                               : "Could not create admin account");
        }
        const std::string id = PQgetvalue(result, 0, 0);
        PQclear(result);
        PQfinish(connection);
        std::cout << "Created administrator account " << id << " for " << email << "\n";
        std::cout << "This is a local bootstrap utility; protect the account and do not expose the database publicly.\n";
        return 0;
    } catch (const std::exception& error) {
        std::fill(password.begin(), password.end(), '\0');
        std::cerr << error.what() << "\n";
        return 1;
    }
}

#include "../src/security.hpp"

#include <cassert>
#include <iostream>
#include <string>

#include <openssl/hmac.h>
#include <chrono>
#include <cstdint>

namespace {
std::string signed_claims(const rideforge_security::json& claims, const std::string& secret) {
    const std::string header_json = R"({"alg":"HS256","typ":"JWT"})";
    const std::string header = rideforge_security::base64url_encode(
        reinterpret_cast<const unsigned char*>(header_json.data()), header_json.size());
    const std::string payload_json = claims.dump();
    const std::string payload = rideforge_security::base64url_encode(
        reinterpret_cast<const unsigned char*>(payload_json.data()), payload_json.size());
    const std::string input = header + "." + payload;
    std::array<unsigned char, EVP_MAX_MD_SIZE> signature{};
    unsigned int signature_size = 0;
    if (HMAC(EVP_sha256(), secret.data(), static_cast<int>(secret.size()),
        reinterpret_cast<const unsigned char*>(input.data()), input.size(),
        signature.data(), &signature_size) == nullptr) {
        throw std::runtime_error("test token signing failed");
    }
    return input + "." + rideforge_security::base64url_encode(signature.data(), signature_size);
}
}


int main() {
    const std::string password = "a-long-demo-password-with-entropy";
    const auto encoded = rideforge_security::password_hash(password);
    assert(encoded.rfind("pbkdf2_sha256$", 0) == 0);
    assert(encoded.rfind("pbkdf2_sha256$600000$", 0) == 0);
    assert(rideforge_security::verify_password(password, encoded));
    assert(!rideforge_security::verify_password("incorrect-password", encoded));
    assert(!rideforge_security::verify_password(password, "plaintext"));

    const std::string secret(48, 's');
    const auto token = rideforge_security::sign_access_token(
        "10000000-0000-4000-8000-000000000001", "passenger", secret);
    const auto claims = rideforge_security::verify_access_token(token, secret);
    assert(claims.subject == "10000000-0000-4000-8000-000000000001");
    assert(claims.role == "passenger");
    assert(claims.expires_at > 0);

    bool rejected = false;
    try {
        (void)rideforge_security::verify_access_token(token + "x", secret);
    } catch (const std::invalid_argument&) {
        rejected = true;
    }
    assert(rejected);

    rejected = false;
    try {
        (void)rideforge_security::sign_access_token("subject", "passenger", "too-short");
    } catch (const std::runtime_error&) {
        rejected = true;
    }
    assert(rejected);

    // Password-hash metadata is parsed strictly; partial integer parses and
    // extra fields must never be accepted as valid PBKDF2 records.
    auto malformed_iterations = encoded;
    const auto iterations_at = malformed_iterations.find("$600000$");
    malformed_iterations.replace(iterations_at + 1, 6, "600000junk");
    assert(!rideforge_security::verify_password(password, malformed_iterations));
    assert(!rideforge_security::verify_password(password, encoded + "$extra"));
    bool invalid_base64_rejected = false;
    try {
        (void)rideforge_security::base64url_decode("AA==");
    } catch (const std::invalid_argument&) {
        invalid_base64_rejected = true;
    }
    assert(invalid_base64_rejected);
    invalid_base64_rejected = false;
    try {
        (void)rideforge_security::base64url_decode("A?");
    } catch (const std::invalid_argument&) {
        invalid_base64_rejected = true;
    }
    assert(invalid_base64_rejected);

    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    const std::string subject = "10000000-0000-4000-8000-000000000001";
    const std::string valid_role = "passenger";
    const auto make_claims = [&](std::int64_t issued, std::int64_t expiry) {
        return rideforge_security::json{{"iss", "rideforge-api"}, {"aud", "rideforge-web"},
            {"sub", subject}, {"role", valid_role}, {"iat", issued}, {"exp", expiry}};
    };
    assert(rideforge_security::verify_access_token(
        signed_claims(make_claims(now, now + 900), secret), secret).subject == subject);

    const auto rejects_claims = [&](const rideforge_security::json& value) {
        bool rejected_claims = false;
        try {
            (void)rideforge_security::verify_access_token(signed_claims(value, secret), secret);
        } catch (const std::exception&) {
            rejected_claims = true;
        }
        assert(rejected_claims);
    };
    auto missing_iat = make_claims(now, now + 900);
    missing_iat.erase("iat");
    rejects_claims(missing_iat);
    rejects_claims(make_claims(now + 120, now + 900));
    rejects_claims(make_claims(now, now + 901));
    rejects_claims(make_claims(now, now - 1));
    auto empty_subject = make_claims(now, now + 900);
    empty_subject["sub"] = "";
    rejects_claims(empty_subject);
    auto invalid_role = make_claims(now, now + 900);
    invalid_role["role"] = "superuser";
    rejects_claims(invalid_role);
    assert(!rideforge_security::verify_password(password, "pbkdf2_sha256$600000junk$bad$bad"));

    std::cout << "Security primitives passed\n";
}

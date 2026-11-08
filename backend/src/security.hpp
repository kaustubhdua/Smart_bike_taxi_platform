#pragma once

#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <nlohmann/json.hpp>

#include <array>
#include <chrono>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace rideforge_security {
using json = nlohmann::json;

inline std::string base64url_encode(const unsigned char* data, std::size_t size) {
    std::string encoded(4 * ((size + 2) / 3), '\0');
    const int written = EVP_EncodeBlock(
        reinterpret_cast<unsigned char*>(encoded.data()), data, static_cast<int>(size));
    if (written < 0) throw std::runtime_error("Base64 encoding failed");
    encoded.resize(static_cast<std::size_t>(written));
    for (char& ch : encoded) {
        if (ch == '+') ch = '-';
        else if (ch == '/') ch = '_';
    }
    while (!encoded.empty() && encoded.back() == '=') encoded.pop_back();
    return encoded;
}

inline std::vector<unsigned char> base64url_decode(std::string value) {
    // JOSE base64url segments are unpadded. Reject alternate alphabets, padding,
    // invalid bytes and non-canonical encodings before parsing signed claims.
    if (value.size() > 8192 || value.size() % 4 == 1) {
        throw std::invalid_argument("Invalid base64url input");
    }
    const std::string original = value;
    if (original.empty()) return {};
    for (char& ch : value) {
        const bool valid = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
            (ch >= '0' && ch <= '9') || ch == '-' || ch == '_';
        if (!valid) throw std::invalid_argument("Invalid base64url input");
        if (ch == '-') ch = '+';
        else if (ch == '_') ch = '/';
    }
    while (value.size() % 4 != 0) value.push_back('=');
    std::vector<unsigned char> decoded(3 * (value.size() / 4) + 3);
    const int written = EVP_DecodeBlock(decoded.data(),
        reinterpret_cast<const unsigned char*>(value.data()), static_cast<int>(value.size()));
    if (written < 0) throw std::invalid_argument("Invalid base64url input");
    std::size_t actual = static_cast<std::size_t>(written);
    if (!value.empty() && value.back() == '=') --actual;
    if (value.size() > 1 && value[value.size() - 2] == '=') --actual;
    decoded.resize(actual);
    if (base64url_encode(decoded.data(), decoded.size()) != original) {
        throw std::invalid_argument("Invalid base64url input");
    }
    return decoded;
}

inline std::string password_hash(std::string_view password) {
    constexpr int iterations = 600000;
    std::array<unsigned char, 16> salt{};
    std::array<unsigned char, 32> derived{};
    if (RAND_bytes(salt.data(), static_cast<int>(salt.size())) != 1 ||
        PKCS5_PBKDF2_HMAC(password.data(), static_cast<int>(password.size()),
            salt.data(), static_cast<int>(salt.size()), iterations, EVP_sha256(),
            static_cast<int>(derived.size()), derived.data()) != 1) {
        throw std::runtime_error("Password hashing unavailable");
    }
    return "pbkdf2_sha256$" + std::to_string(iterations) + "$" +
        base64url_encode(salt.data(), salt.size()) + "$" +
        base64url_encode(derived.data(), derived.size());
}

inline bool verify_password(std::string_view password, const std::string& encoded) {
    const auto first = encoded.find('$');
    const auto second = first == std::string::npos ? first : encoded.find('$', first + 1);
    const auto third = second == std::string::npos ? second : encoded.find('$', second + 1);
    if (first == std::string::npos || second == std::string::npos ||
        third == std::string::npos || encoded.find('$', third + 1) != std::string::npos ||
        encoded.substr(0, first) != "pbkdf2_sha256") return false;
    const std::string iteration_text = encoded.substr(first + 1, second - first - 1);
    if (iteration_text.empty() || iteration_text.find_first_not_of("0123456789") != std::string::npos) return false;
    int iterations = 0;
    try {
        std::size_t parsed = 0;
        iterations = std::stoi(iteration_text, &parsed);
        if (parsed != iteration_text.size()) return false;
    } catch (...) {
        return false;
    }
    if (iterations < 100000 || iterations > 1000000) return false;
    try {
        const auto salt = base64url_decode(encoded.substr(second + 1, third - second - 1));
        const auto expected = base64url_decode(encoded.substr(third + 1));
        if (salt.size() != 16 || expected.size() != 32) return false;
        std::array<unsigned char, 32> derived{};
        if (PKCS5_PBKDF2_HMAC(password.data(), static_cast<int>(password.size()),
            salt.data(), static_cast<int>(salt.size()), iterations, EVP_sha256(),
            static_cast<int>(derived.size()), derived.data()) != 1) return false;
        return CRYPTO_memcmp(derived.data(), expected.data(), expected.size()) == 0;
    } catch (...) {
        return false;
    }
}

inline std::string sign_access_token(const std::string& subject, const std::string& role,
                                     const std::string& secret) {
    if (secret.size() < 32) throw std::runtime_error("RIDEFORGE_JWT_SECRET must contain at least 32 characters");
    if (subject.empty() || subject.size() > 128 ||
        (role != "passenger" && role != "driver" && role != "admin")) {
        throw std::invalid_argument("Invalid access token subject or role");
    }
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    const std::string header = base64url_encode(
        reinterpret_cast<const unsigned char*>(R"({"alg":"HS256","typ":"JWT"})"), 27);
    const json claims{{"iss", "rideforge-api"}, {"aud", "rideforge-web"}, {"sub", subject},
        {"role", role}, {"iat", now}, {"exp", now + 900}};
    const std::string payload_json = claims.dump();
    const std::string payload = base64url_encode(
        reinterpret_cast<const unsigned char*>(payload_json.data()), payload_json.size());
    const std::string signing_input = header + "." + payload;
    std::array<unsigned char, EVP_MAX_MD_SIZE> signature{};
    unsigned int signature_size = 0;
    if (HMAC(EVP_sha256(), secret.data(), static_cast<int>(secret.size()),
        reinterpret_cast<const unsigned char*>(signing_input.data()), signing_input.size(),
        signature.data(), &signature_size) == nullptr) {
        throw std::runtime_error("Token signing unavailable");
    }
    return signing_input + "." + base64url_encode(signature.data(), signature_size);
}

struct Claims {
    std::string subject;
    std::string role;
    std::int64_t expires_at{};
};

inline Claims verify_access_token(const std::string& token, const std::string& secret) {
    if (secret.size() < 32) throw std::runtime_error("Token verification unavailable");
    const auto first = token.find('.');
    const auto second = first == std::string::npos ? first : token.find('.', first + 1);
    if (first == std::string::npos || second == std::string::npos ||
        token.find('.', second + 1) != std::string::npos || token.size() > 4096) {
        throw std::invalid_argument("Invalid access token");
    }
    const std::string signing_input = token.substr(0, second);
    const auto supplied = base64url_decode(token.substr(second + 1));
    std::array<unsigned char, EVP_MAX_MD_SIZE> expected{};
    unsigned int expected_size = 0;
    if (HMAC(EVP_sha256(), secret.data(), static_cast<int>(secret.size()),
        reinterpret_cast<const unsigned char*>(signing_input.data()), signing_input.size(),
        expected.data(), &expected_size) == nullptr || supplied.size() != expected_size ||
        CRYPTO_memcmp(supplied.data(), expected.data(), expected_size) != 0) {
        throw std::invalid_argument("Invalid access token");
    }
    const auto header = json::parse(base64url_decode(token.substr(0, first)));
    const auto claims = json::parse(base64url_decode(token.substr(first + 1, second - first - 1)));
    if (!header.is_object() || header.value("alg", std::string()) != "HS256" ||
        header.value("typ", std::string()) != "JWT" || !claims.is_object() ||
        claims.value("iss", std::string()) != "rideforge-api" ||
        claims.value("aud", std::string()) != "rideforge-web" ||
        !claims.contains("sub") || !claims["sub"].is_string() ||
        claims["sub"].get<std::string>().empty() || claims["sub"].get<std::string>().size() > 128 ||
        !claims.contains("role") || !claims["role"].is_string() ||
        !claims.contains("iat") || !claims["iat"].is_number_integer() ||
        !claims.contains("exp") || !claims["exp"].is_number_integer()) {
        throw std::invalid_argument("Invalid access token claims");
    }
    const auto issued_at = claims["iat"].get<std::int64_t>();
    const auto expiry = claims["exp"].get<std::int64_t>();
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    // This service issues 15-minute access tokens. Accept a small clock skew,
    // but reject future-issued, already-expired, overlong or inverted windows.
    if (issued_at > now + 60 || expiry <= now || expiry <= issued_at ||
        expiry > issued_at + 900 || expiry > now + 960) {
        throw std::invalid_argument("Invalid access token lifetime");
    }
    const std::string role = claims["role"].get<std::string>();
    if (role != "passenger" && role != "driver" && role != "admin") {
        throw std::invalid_argument("Invalid access token role");
    }
    return {claims["sub"].get<std::string>(), role, expiry};
}
} // namespace rideforge_security

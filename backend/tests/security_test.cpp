#include "../src/security.hpp"

#include <cassert>
#include <iostream>
#include <string>

int main() {
    const std::string password = "a-long-demo-password-with-entropy";
    const auto encoded = saarthi_security::password_hash(password);
    assert(encoded.rfind("pbkdf2_sha256$", 0) == 0);
    assert(saarthi_security::verify_password(password, encoded));
    assert(!saarthi_security::verify_password("incorrect-password", encoded));
    assert(!saarthi_security::verify_password(password, "plaintext"));

    const std::string secret(48, 's');
    const auto token = saarthi_security::sign_access_token(
        "10000000-0000-4000-8000-000000000001", "passenger", secret);
    const auto claims = saarthi_security::verify_access_token(token, secret);
    assert(claims.subject == "10000000-0000-4000-8000-000000000001");
    assert(claims.role == "passenger");
    assert(claims.expires_at > 0);

    bool rejected = false;
    try {
        (void)saarthi_security::verify_access_token(token + "x", secret);
    } catch (const std::invalid_argument&) {
        rejected = true;
    }
    assert(rejected);

    rejected = false;
    try {
        (void)saarthi_security::sign_access_token("subject", "passenger", "too-short");
    } catch (const std::runtime_error&) {
        rejected = true;
    }
    assert(rejected);
    std::cout << "Security primitives passed\n";
}

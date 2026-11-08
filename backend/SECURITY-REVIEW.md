# JWT Authentication Security Review

## 1. Overall Readiness

**FAIL — Not ready to claim end-to-end JWT authentication.** The API Gateway has an RS256 verification middleware and compatible RSA keys, but none of the six proxy routes applies authentication. No User Service token-issuance flow was found in the reviewed files. Whether downstream services enforce authorization independently was not established.

## 2. RSA Key Pair Review

- **PASS:** All three key files exist and parse as RSA 2048-bit PEM keys. The User Service public key and API Gateway public key match the public key derived from the User Service private key.
- **PASS:** API Gateway verification uses its public key in `api-gateway/src/middleware/authMiddleware.js`.
- **WARNING:** `user-service/keys/private.pem` is stored as a cleartext file in the project tree. Whether it has been shared or deployed is unknown. Treat it as exposed if it has.
- **NOT IMPLEMENTED:** User Service was not found loading or using the private key to sign tokens; key-file presence alone does not establish signing.

No key contents are included in this report.

## 3. JWT Authentication Review

- **PASS:** `api-gateway/src/middleware/authMiddleware.js` extracts a Bearer token from the Authorization header (lines 15–24) and verifies it with `jwt.verify`, restricted to RS256 (lines 27–28). Invalid signatures and expired `exp` values are subject to verification failure.
- **WARNING:** Expiration is checked only when `exp` is present; a validly signed token without `exp` can be accepted. A maximum token age is not configured.
- **WARNING:** The decoded payload is assigned wholesale to `req.user` (line 31), without validating required claim presence or types.
- **NOT IMPLEMENTED:** Issuer and audience constraints are not configured.

## 4. Authorization Review

- **PASS:** `api-gateway/src/middleware/roleMiddleware.js` checks that `req.user` exists and compares its role against the supplied allowed-role list (lines 5–18).
- **WARNING:** `shared/constants/index.js` defines `CUSTOMER`, `STAFF`, `TECHNICIAN`, and `ADMIN`, but the reviewed route setup does not use these constants or apply the role middleware.
- **NOT IMPLEMENTED:** No role-based access rules are wired to the six gateway proxies.

## 5. API Gateway Routing Review

All six proxy routes in `api-gateway/src/routes/serviceRoutes.js` are currently public/unprotected; `api-gateway/server.js` mounts the router without applying authentication (lines 19–21).

| Route | Target environment variable |
|---|---|
| `/api/users` | `USER_SERVICE_URL` |
| `/api/bookings` | `BOOKING_SERVICE_URL` |
| `/api/catalog` | `CATALOG_SERVICE_URL` |
| `/api/repairs` | `REPAIR_SERVICE_URL` |
| `/api/inventory` | `INVENTORY_SERVICE_URL` |
| `/api/payments` | `PAYMENT_SERVICE_URL` |

No target fallback is defined in the route code.

- **WARNING:** Proxy configuration sets a target and `changeOrigin`, but no explicit proxy error callback is configured (`api-gateway/src/routes/serviceRoutes.js`, lines 4–9).
- **PASS:** Gateway not-found/error handlers are mounted after routes (`api-gateway/server.js`, lines 32–33); `api-gateway/src/middleware/errorMiddleware.js` returns a generic 500 response.

## 6. User Service Integration Review

- **NOT IMPLEMENTED:** `user-service/server.js` contains middleware setup and a health endpoint, but no Login/Register/token-issuance implementation or private-key signing use was found. The reviewed code therefore does not demonstrate issuing valid RS256 JWTs.
- **PASS:** The private key and corresponding public key files exist and match. Database configuration remains present in `user-service/src/config/database.js`.

## 7. Security Issues

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟠 HIGH | `user-service/keys/private.pem` | — | Cleartext signing private key is stored in the project tree; if obtained, it can mint tokens accepted by the matching gateway public key. Sharing/deployment status is unknown. | 8/10 |
| 2 | 🟡 MEDIUM | `api-gateway/src/routes/serviceRoutes.js` | 14–47 | All six service proxies lack authentication/role checks, so the gateway forwards unauthenticated requests. Downstream authorization was not assessed. | 9/10 |
| 3 | 🟡 MEDIUM | `api-gateway/src/middleware/authMiddleware.js` | 27–31 | Tokens are not required to contain `exp`, `iss` and `aud` are not validated, and decoded claims are trusted wholesale as `req.user`. | 8/10 |
| 4 | ⚪ LOW | `api-gateway/server.js` | 16 | Default `cors()` allows any origin. No credentialed CORS setting was observed; this alone does not establish an authorization bypass. | 8/10 |

API Gateway `.env` and `.env.example` values were not included. The inspected configuration names were `NODE_ENV`, `PORT`, `USER_SERVICE_URL`, `BOOKING_SERVICE_URL`, `CATALOG_SERVICE_URL`, `REPAIR_SERVICE_URL`, `INVENTORY_SERVICE_URL`, and `PAYMENT_SERVICE_URL`.

## 8. Missing Implementations

- User Service token issuance/signing using the private key.
- Authentication on protected gateway proxy routes, with explicit identification of any intentionally public endpoints.
- Route-specific authorization using the shared role constants.
- Required expiry and appropriate issuer/audience checks; validation of expected JWT claim types and shape.
- Secure signing-key storage and a key rotation plan.
- Explicit proxy failure handling and restrictive CORS origins, as appropriate for deployment.

## 9. Recommended Implementation Order

1. Protect and, if shared or deployed, rotate the private key; keep signing material in a managed secret store.
2. Implement User Service token issuance with the private key and a defined claim/expiry policy.
3. Apply authentication and route-specific authorization at the gateway; confirm downstream services enforce authorization where needed.
4. Require and validate `exp`, configure appropriate `iss`/`aud`, and validate claims before assigning `req.user`.
5. Restrict CORS and define explicit proxy error behavior; add tests for missing, invalid, expired, and unauthorized requests.

**Summary:** RS256 verification and key compatibility are present, but JWT integration requires corrections before it is ready: there is no demonstrated token issuer and no gateway proxy route enforces authentication.

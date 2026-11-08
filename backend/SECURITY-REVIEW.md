# JWT Authentication and Authorization Security Review

## Historical Security Review — Findings at the Time of Original Review

The following findings describe the implementation and evidence available during the original review. They are retained for audit history and are not statements of the current code state.

### Historical implementation status

- The Gateway had RS256 verification middleware, but the reviewed service proxy routes did not apply it.
- No User Service token-issuance flow was found in the files reviewed at that time.
- The then-reviewed Gateway verifier did not require `exp`, validate `iss`/`aud`, or validate claim shape before assigning request context.
- The then-reviewed role middleware was not wired to proxy routes, and shared role definitions did not match the currently approved three-role model.
- The then-reviewed Gateway used default CORS behavior rather than an exact-origin allowlist.
- Proxy failure handling and downstream authorization had not been established.

### Historical key-management concern

- A JWT signing private key was present as a cleartext file in the project tree and had also appeared in Git history.
- The corresponding public key could verify tokens signed by that private key. Anyone obtaining the private key could potentially mint tokens accepted by a verifier trusting the corresponding public key.
- Whether the historical key was pushed, shared, or trusted by a deployment was not verified. Treat the historical key as potentially exposed; deleting a working-tree file does not erase Git history or revoke a key.

### Historical readiness conclusion

At the time, the implementation was not ready to claim end-to-end JWT authentication or protected business authorization. Those findings motivated the subsequent authentication, routing, and authorization work. They must not be interpreted as a complete record of current verification.

## Current Security Verification — 2026-11-08

The following describes the current repository implementation verified on 2026-11-08. It is not a production-readiness certification.

### JWT issuance and validation

- **Verified:** User Service login issues access tokens using RS256, with `sub`, roles, issuer, audience, issued-at time, and configured expiration. The configured lifetime is represented in seconds.
- **Verified:** Gateway JWT middleware restricts accepted algorithms to RS256 and verifies the signature, expiration, issuer, and audience before accepting the token.
- **Verified:** The middleware validates the subject and roles claim shape and allows only the configured role codes before creating the normalized authenticated context.

Relevant implementation: `user-service/src/services/authService.js`, `user-service/src/config/jwt.js`, and `api-gateway/src/middleware/authMiddleware.js`.

### Gateway routing and browser controls

- **Verified:** The public Gateway allowlist contains only `POST /api/users/auth/register` and `POST /api/users/auth/login`.
- **Verified:** Other User Service routes and the Booking, Catalog, Repair, Inventory, and Payment service prefixes remain denied. Protected Business Routes are not enabled.
- **Verified:** CORS uses exact-origin allowlisting, rejects unlisted origins, does not allow credentials, and fails closed when no origins are configured.
- **Verified:** Login rate limiting is implemented.

Relevant implementation: `api-gateway/src/routes/serviceRoutes.js`, `api-gateway/src/middleware/corsMiddleware.js`, `api-gateway/src/middleware/loginRateLimit.js`, and `api-gateway/src/app.js`.

### Authentication and authorization foundation

- **Verified:** JWT Authentication Middleware exists and establishes the authenticated request context from verified claims.
- **Verified:** Role Middleware exists and denies missing or invalid role context.
- **Verified:** Permission Middleware and server-side Role-Permission Mapping are implemented. The roles are `CUSTOMER`, `TECHNICIAN`, and `ADMIN`; there is no `STAFF` role.
- **Verified:** Pending permissions remain ungranted, including Refund and Payment Void permissions, `inventory.manage`, and Technician/Admin profile permissions.
- **Limitation:** The Authentication, Role, and Permission middleware are not wired to Protected Business Routes because those routes are not enabled.

Relevant implementation: `shared/constants/index.js`, `api-gateway/src/middleware/authMiddleware.js`, `api-gateway/src/middleware/roleMiddleware.js`, and `api-gateway/src/middleware/permissionMiddleware.js`.

### Test results

- **Verified:** API Gateway tests: **39/39 passed**.
- **Verified:** User Service tests: **22/22 passed**.

These are repository test results, not evidence that every production deployment uses the inspected configuration.

## Remaining Risks and Limitations

- **Resource-level authorization is not implemented.** Ownership, technician assignment, and business-resource scope checks must be implemented in the services that own those resources before protected APIs are exposed.
- **Protected Business APIs are not available.** The current Gateway deny-by-default behavior is intentional; the authorization middleware is foundation code and is not yet attached to business routes.
- **Five Business Services remain skeletons:** Booking, Catalog, Repair, Inventory, and Payment currently expose infrastructure/health behavior rather than implemented business APIs.
- **Login rate limiting is process-local.** It does not provide a shared limit across multiple Gateway instances and may need a distributed store and deployment-aware IP handling.
- **Production deployment settings have not been verified.** Local configuration and tests do not establish production runtime settings.
- **Deployment key trust and key rotation have not been verified.** It remains unknown whether any deployed environment ever trusted the historical public key or whether it has been fully retired everywhere.
- **Database grants and least-privilege configuration have not been verified.**
- **Production logging destinations, access controls, and retention have not been verified.**
- **Historical private-key exposure remains a concern.** The former private key must be treated as potentially compromised unless deployment and repository exposure investigations establish otherwise. The current repository's ignore rules do not remove copies from Git history, clones, backups, or checkpoints.

## Readiness Conclusion

**Not production-ready for Protected Business APIs.** JWT issuance and Gateway verification, restrictive Gateway routing, CORS allowlisting, rate limiting, and the Permission-based Authorization Foundation are implemented and covered by the reported tests. Resource-level authorization, Business Service APIs, deployment verification, key-trust/rotation verification, database privilege verification, and production logging review remain outstanding.

No claim is made here that the historical key was or was not deployed, that production environments match local configuration, or that business authorization is enforced end to end.

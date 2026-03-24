# Technical Specification: User Authentication API

## Architecture

### Stack
- **Runtime:** Node.js 18+ with TypeScript
- **Framework:** Express.js with helmet and cors
- **Database:** PostgreSQL 14+ with Prisma ORM
- **Token Storage:** Redis (refresh tokens)
- **Testing:** Vitest with @fast-check for property tests

### Module Structure

```
src/
├── auth/
│   ├── handlers/         # Express route handlers
│   ├── services/         # Business logic
│   ├── validators/       # Input validation (zod)
│   ├── middleware/       # Auth middleware
│   └── types.ts          # Domain types
├── db/
│   ├── schema.prisma     # Database schema
│   └── client.ts         # Prisma client
└── utils/
    ├── passwords.ts      # bcrypt helpers
    ├── tokens.ts         # JWT helpers
    └── rate-limiter.ts   # Rate limiting
```

## Implementation Plan

### Phase 1: Database Schema
- [x] Create User table with Prisma
- [x] Create RefreshToken table
- [x] Add indexes on email and token fields
- [x] Write migration

### Phase 2: Core Services
- [x] Password hashing service (bcrypt)
- [x] JWT token service (jsonwebtoken)
- [x] Rate limiter (express-rate-limit)
- [x] Input validation schemas (zod)

### Phase 3: API Endpoints
- [x] POST /auth/register
- [x] POST /auth/login
- [x] POST /auth/refresh
- [x] POST /auth/logout

### Phase 4: Security & Testing
- [x] Authentication middleware
- [x] Rate limiting on all auth endpoints
- [x] Unit tests for services
- [x] Integration tests for endpoints
- [x] Property tests for validation

## Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "express-rate-limit": "^7.1.5",
    "zod": "^3.22.4",
    "@prisma/client": "^5.7.0",
    "ioredis": "^5.3.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/bcrypt": "^5.0.2",
    "@types/jsonwebtoken": "^9.0.5",
    "@fast-check/vitest": "^0.1.0",
    "prisma": "^5.7.0",
    "vitest": "^1.1.0"
  }
}
```

## Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:pass@localhost:5432/authdb"

# Redis (for refresh tokens)
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-secret-key-min-32-chars-long"
JWT_ACCESS_EXPIRES_IN="1h"
JWT_REFRESH_EXPIRES_IN="7d"

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=5
```

## Error Handling Strategy

All errors return JSON with consistent structure:

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "details": null
  }
}
```

Error codes:
- `AUTH_INVALID_CREDENTIALS` - Login failed
- `AUTH_EMAIL_EXISTS` - Registration conflict
- `AUTH_TOKEN_EXPIRED` - Token validation failed
- `AUTH_TOKEN_INVALID` - Malformed token
- `AUTH_RATE_LIMITED` - Too many requests

## Testing Strategy

### Unit Tests (Vitest)
- Password hashing/verification
- Token generation/validation
- Input validation schemas

### Integration Tests
- Full request/response cycles
- Database state verification
- Rate limiting behavior

### Property Tests (@fast-check)
- Email format validation accepts all valid emails
- Password strength requirements
- Token uniqueness across generations

## Performance Considerations

- bcrypt cost factor: 12 (balance security/performance)
- Redis for refresh tokens: O(1) lookup vs DB query
- Connection pooling: Prisma default 5-10 connections
- Rate limiter: In-memory with 1-minute window

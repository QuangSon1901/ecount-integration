# PHASE 2 — OMS AUTH SYSTEM

## Context

Each customer has its own OMS credentials.

## Requirements

- OAuth2 client_credentials
- Cache access_token
- Handle expiration

## Tasks

1. Build OMS auth service
2. Implement:
   - Get token
   - Cache token (DB or memory)
   - Auto refresh

## Constraints

- One token per customer
- Avoid calling auth API too frequently

## Output Format

1. Flow explanation
2. Service code (Node.js)
3. Token cache strategy
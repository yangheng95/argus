# Moment Diary - Detailed Architecture Document

**Version**: 1.0  
**Date**: March 11, 2026  
**Author**: OpenCorvus Architecture Team

---

## Document Purpose

This document provides a detailed technical architecture for the **Moment Diary** application, including system design, component interactions, data flow, and implementation guidelines.

---

## System Architecture Overview

### High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Tier                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Web App     │  │  iOS App     │  │ Android App  │          │
│  │  (React)     │  │  (SwiftUI)   │  │  (Compose)   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
└─────────┼──────────────────┼──────────────────┼──────────────────┘
          │ HTTPS/WSS        │                  │
┌─────────┴──────────────────┴──────────────────┴──────────────────┐
│                      Edge & Gateway Tier                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │           CDN (Cloudflare / CloudFront)                │    │
│  │    - Static assets caching                             │    │
│  │    - DDoS protection                                   │    │
│  │    - Geographic distribution                          │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │      API Gateway (Kong / AWS API Gateway)             │    │
│  │    - Request routing                                   │    │
│  │    - Rate limiting                                     │    │
│  │    - Authentication enforcement                       │    │
│  │    - Request/response transformation                  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
          │
┌─────────┴─────────────────────────────────────────────────────────┐
│                    Application Services Tier                       │
│                    (Kubernetes Cluster)                            │
│                                                                    │
│  ┌─────────────────────┐  ┌─────────────────────┐                │
│  │  Auth Service       │  │  Diary Service      │                │
│  │  - Registration     │  │  - CRUD operations  │                │
│  │  - Login/Logout     │  │  - Version control  │                │
│  │  - JWT tokens       │  │  - Tagging          │                │
│  │  - OAuth2           │  │  - Categorization   │                │
│  └────────┬────────────┘  └────────┬────────────┘                │
│           │                        │                              │
│  ┌────────┴────────┐  ┌───────────┴──────────┐                   │
│  │  File Service   │  │  Search Service      │                   │
│  │  - Upload       │  │  - Full-text search  │                   │
│  │  - Processing   │  │  - Filtering         │                   │
│  │  - Download     │  │  - Indexing          │                   │
│  │  - Thumbnail    │  │  - Analytics         │                   │
│  └────────┬────────┘  └────────┬─────────────┘                   │
│           │                    │                                  │
└───────────┼────────────────────┼──────────────────────────────────┘
            │                    │
┌───────────┴────────────────────┴──────────────────────────────────┐
│                      Data Persistence Tier                         │
│  ┌──────────────────────┐                                         │
│  │  PostgreSQL          │                                         │
│  │  - Primary database  │                                         │
│  │  - Read replicas     │                                         │
│  │  - Backups           │                                         │
│  │  - Point-in-time     │                                         │
│  │    recovery          │                                         │
│  └──────────┬───────────┘                                         │
│  ┌──────────▼───────────┐  ┌──────────────────────┐              │
│  │  Redis Cluster       │  │  Elasticsearch       │              │
│  │  - Session cache     │  │  - Full-text index   │              │
│  │  - Query cache       │  │  - Aggregations      │              │
│  │  - Rate limits       │  │  - Analytics         │              │
│  │  - Real-time data    │  │  - Suggestions       │              │
│  └──────────────────────┘  └──────────────────────┘              │
│  ┌──────────────────────┐                                         │
│  │  S3/Object Storage   │                                         │
│  │  - File uploads      │                                         │
│  │  - Backups           │                                         │
│  │  - Archives          │                                         │
│  └──────────────────────┘                                         │
└────────────────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### 1. Auth Service Architecture

```
┌─────────────────────────────────────────────────────┐
│              Auth Service                            │
├─────────────────────────────────────────────────────┤
│  Controllers                                         │
│  ├─ AuthController                                 │
│  │  ├─ POST /register                             │
│  │  ├─ POST /login                                │
│  │  ├─ POST /logout                               │
│  │  ├─ POST /refresh-token                        │
│  │  └─ GET /me                                    │
│  └─ OAuthController                               │
│     ├─ GET /oauth/google/callback                │
│     ├─ GET /oauth/github/callback                │
│     └─ POST /oauth/verify                        │
├─────────────────────────────────────────────────────┤
│  Business Logic Layer                              │
│  ├─ AuthService                                   │
│  │  ├─ register()                                 │
│  │  ├─ login()                                    │
│  │  ├─ logout()                                   │
│  │  ├─ validateToken()                           │
│  │  ├─ refreshToken()                            │
│  │  └─ resetPassword()                           │
│  └─ TokenService                                 │
│     ├─ generateAccessToken()                     │
│     ├─ generateRefreshToken()                    │
│     ├─ verifyToken()                             │
│     └─ revokeToken()                             │
├─────────────────────────────────────────────────────┤
│  Data Layer                                        │
│  └─ UserRepository                               │
│     ├─ findByEmail()                             │
│     ├─ findById()                                │
│     ├─ create()                                  │
│     ├─ update()                                  │
│     └─ updateLastLogin()                         │
├─────────────────────────────────────────────────────┤
│  Utilities                                         │
│  ├─ PasswordHasher (bcrypt)                      │
│  ├─ JwtManager                                   │
│  ├─ OAuthProvider                                │
│  └─ EmailService                                 │
└─────────────────────────────────────────────────────┘
```

### 2. Diary Service Architecture

```
┌──────────────────────────────────────────────────────┐
│            Diary Service                             │
├──────────────────────────────────────────────────────┤
│  Controllers                                         │
│  ├─ DiaryController                               │
│  │  ├─ GET /diaries                              │
│  │  ├─ POST /diaries                             │

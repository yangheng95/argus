# Moment Diary - Technical Solution Document

**Document Version**: 1.0  
**Last Updated**: 2026-03-11  
**Author**: OpenCorvus Technical Team

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Design](#architecture-design)
3. [Frontend Solution](#frontend-solution)
4. [Backend Solution](#backend-solution)
5. [Database Design](#database-design)
6. [API Specification](#api-specification)
7. [Security & Authentication](#security--authentication)
8. [Deployment Strategy](#deployment-strategy)
9. [Technology Stack](#technology-stack)
10. [Development Workflow](#development-workflow)

---

## Project Overview

### 1.1 Application Introduction

**Moment Diary** is a modern diary application that provides users with:

- 📝 Rich content writing experience
- 🔍 Powerful diary search and filtering
- 📸 Multimedia support (images, audio)
- 🏷️ Tag-based categorization
- 💾 Cloud backup and synchronization
- 🔐 End-to-end encryption for privacy
- 📊 Diary analytics and statistics
- 📱 Cross-platform support (Web, iOS, Android)

### 1.2 Core Goals

- Provide intuitive and user-friendly diary interface
- Ensure user data security and privacy protection
- Support multi-device synchronization and offline usage
- Deliver optimal performance and user experience
- Enable easy extensibility and maintenance

---

## Architecture Design

### 2.1 Overall Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Layer                           │
├──────────────────┬──────────────────┬──────────────────┐
│   Web App        │   iOS App        │   Android App    │
│  (React/Vue)     │  (Swift)         │  (Kotlin)        │
└────────┬─────────┴────────┬─────────┴────────┬─────────┘
         │                  │                  │
         └──────────────────┼──────────────────┘
                            │ HTTPS/WSS
         ┌──────────────────┴──────────────────┐
         │      API Gateway & Load Balancer    │
         └──────────────────┬──────────────────┘
                            │
         ┌──────────────────┴──────────────────┐
         │    Backend Services (Microservices) │
         │                                     │
         │  ┌─────────────────────────────┐   │
         │  │ Auth Service                │   │
         │  └─────────────────────────────┘   │
         │  ┌─────────────────────────────┐   │
         │  │ Diary Service               │   │
         │  └─────────────────────────────┘   │
         │  ┌─────────────────────────────┐   │
         │  │ File Service                │   │
         │  └─────────────────────────────┘   │
         │  ┌─────────────────────────────┐   │
         │  │ Search & Analytics Service  │   │
         │  └─────────────────────────────┘   │
         └─────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
    ┌────▼────┐        ┌────▼────┐       ┌────▼────┐
    │ Database │        │  Cache  │       │ Storage │
    │(PgSQL)   │        │(Redis)  │       │  (S3)   │
    └──────────┘        └─────────┘       └────────┘
```

### 2.2 Architecture Principles

- **Microservices**: Separated by domain for scalability
- **API-First**: All services communicate via RESTful APIs
- **Multi-layer Caching**: Browser, CDN, server, database
- **Async Processing**: Message queues for heavy operations
- **Cloud-Native**: Container-based, auto-scaling

---

## Frontend Solution

### 3.1 Technology Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Framework | React 18+ | Mature ecosystem, excellent performance |
| Build Tool | Vite | Fast startup, excellent HMR |
| UI Library | shadcn/ui + Tailwind CSS | Highly customizable, modern |
| State Management | Zustand | Lightweight, easy to use |
| HTTP Client | Axios / TanStack Query | Request management, caching |
| Real-time | Socket.io / WebSocket | Notifications, sync |
| Form Handling | React Hook Form | Efficient, lightweight |
| Validation | Zod / Yup | Type-safe validation |
| i18n | i18next | Multi-language support |
| Monitoring | Sentry + Web Vitals | Error tracking, performance |

### 3.2 Project Structure

```
web/
├── src/
│   ├── assets/              # Static assets
│   ├── components/          # React components
│   │   ├── common/          # Shared components
│   │   ├── diary/           # Diary components
│   │   ├── editor/          # Editor components
│   │   └── layout/          # Layout components
│   ├── hooks/               # Custom hooks
│   ├── pages/               # Page components
│   ├── services/            # API services
│   ├── store/               # State management
│   ├── types/               # TypeScript types
│   ├── utils/               # Utility functions
│   ├── App.tsx
│   └── main.tsx
├── public/
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### 3.3 Core Features

#### 3.3.1 Diary Editor
- Rich text editing (Slate/Draft.js)
- Markdown support
- Auto-save
- Version history
- Media embedding

#### 3.3.2 Diary List
- Virtual scrolling
- Search and filtering
- Multiple view modes
- Tag management

#### 3.3.3 Analytics
- Full-text search
- Statistics visualization
- Mood tracking
- Writing streaks

### 3.4 Performance Targets

- LCP < 2.5s
- CLS < 0.1
- FID < 100ms

---

## Backend Solution

### 4.1 Technology Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Runtime | Node.js / Go | High performance |
| Framework | Nest.js | Enterprise-ready |
| Database | PostgreSQL | Reliable, feature-rich |
| Cache | Redis | High-speed caching |
| Message Queue | RabbitMQ | Service decoupling |
| Search | Elasticsearch | Full-text search |
| Logging | ELK Stack | Centralized logging |

### 4.2 Microservices

#### Auth Service
- User registration/login
- JWT token management
- OAuth2 integration
- Session management

#### Diary Service
- CRUD operations
- Version control
- Tag/category management
- Statistics

#### File Service
- Media upload/download
- Image processing
- Storage management

#### Search Service
- Full-text search
- Advanced filtering
- Result ranking

### 4.3 Core Flows

**Diary Creation**:
1. User submits diary
2. Auth verification
3. Store in database
4. Process files
5. Index for search
6. Update statistics

**Search**:
1. Parse search query
2. Query Elasticsearch
3. Rank results
4. Return with highlights

---

## Database Design

### 5.1 Selection: PostgreSQL

**Advantages**:
- ACID transactions
- JSON & Array types
- Full-text search
- High reliability

### 5.2 Core Tables

#### Users Table
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Diaries Table
```sql
CREATE TABLE diaries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(500),
  content TEXT NOT NULL,
  mood VARCHAR(50),
  visibility VARCHAR(20) DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
```

#### Tags Table
```sql
CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  color VARCHAR(7),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);
```

#### Media Table
```sql
CREATE TABLE media (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  diary_id INTEGER REFERENCES diaries(id),
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  storage_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Specification

### 6.1 Design Principles

- RESTful design
- Version control `/api/v1`
- Consistent response format
- Clear error handling
- Input validation

### 6.2 Response Format

**Success Response**:
```json
{
  "code": 0,
  "message": "Success",
  "data": {},
 

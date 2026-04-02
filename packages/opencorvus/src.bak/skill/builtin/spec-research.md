---
name: spec-research
description: Research and compile a comprehensive SPEC from user query using web search, tech stack analysis, and best practices
stage: spec
priority: 10
---

# Spec Research Skill

When the user provides a vague or high-level request, use this workflow to research and produce a production-quality SPEC before execution begins.

## When to Activate

- The user's request describes a product/feature idea without specifying technology choices
- The request mentions "research", "investigate", or "help me design"
- The request is a PRD or feature description that needs a concrete implementation plan

## Research Phase

Use **web search** and **memory search** to gather:

1. **Framework & Library Selection**
   - Search for the best current frameworks for the project type (e.g., "best React meta-framework 2026", "TypeScript ORM comparison")
   - Compare maturity, community size, bundle size, DX
   - Pick ONE stack — don't leave choices open

2. **Architecture Patterns**
   - Search for production patterns (e.g., "full-stack TypeScript project structure", "REST API best practices")
   - Identify the standard project layout for the chosen stack
   - Note authentication, state management, and data access patterns

3. **UI/UX References**
   - Search for design patterns relevant to the product (e.g., "diary app UI patterns", "dashboard design best practices")
   - Identify expected pages, navigation patterns, responsive breakpoints

4. **Testing Strategy**
   - Search for the testing tools that pair with the chosen stack
   - Identify what to test (API endpoints, UI rendering, business logic)

## Output Format

Produce a SPEC with these exact sections:

### Technology Stack (Fixed)
List every dependency with version. No "or equivalent" — pick one.
```
Runtime: Bun
Framework: Hono (backend) + React 19 (frontend)
Build: Vite
CSS: Tailwind v4
Database: SQLite via bun:sqlite
Testing: bun:test
```

### Project Structure
```
file-tree with every directory and key files
```

### API Endpoints
For each endpoint:
- Method + Path
- Request body schema
- Response schema
- Auth requirement

### Database Schema
Complete CREATE TABLE SQL — not field lists, executable SQL.

### Frontend Pages
For each page:
- Route path
- Components needed
- Data fetching
- User interactions

### Acceptance Criteria
- Specific commands that must pass (build, test, typecheck)
- Specific user flows that must work (register → login → create → view)
- Specific quality bars (responsive at 375px, dark mode, loading states)

## Rules

- Every technology choice must be justified by the research findings
- No "the developer may choose" — every decision is final
- Include exact version numbers where possible
- DDL must be copy-paste executable SQL, not pseudo-schemas
- The spec must be self-contained — an agent reading only this spec can build the project without asking questions
- Write the spec in the same language as the user's request

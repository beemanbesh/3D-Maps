# Contributing to 3D Development Platform

## Development Setup

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local frontend development)
- Python 3.11+ (for local backend development)

### Quick Start
```bash
# Clone the repository
git clone <repo-url>
cd 3d-development-platform

# Copy environment file
cp .env.example .env
# Edit .env with your API keys (ANTHROPIC_API_KEY, MAPBOX_ACCESS_TOKEN)

# Start all services
docker compose up -d

# Access the app
# Frontend: http://localhost:5173
# Backend API: http://localhost:8000/docs
# MinIO Console: http://localhost:9001
```

### Running Tests
```bash
# Backend tests
docker compose exec backend pytest tests/ -v

# Frontend tests
docker compose exec frontend npx vitest run
```

## Code Style

### Backend (Python)
- **Formatter:** Black (line length 120)
- **Linter:** Ruff
- **Type checker:** mypy
- Run locally: `black . && ruff check . && mypy app/ --ignore-missing-imports`

### Frontend (TypeScript/React)
- **Linter:** ESLint
- **Framework:** React 18 + TypeScript
- **State:** Zustand (stores), TanStack React Query (server state)
- **3D:** React Three Fiber + drei
- **Styling:** Tailwind CSS

## Branch Naming
- `feature/<short-description>` for new features
- `fix/<short-description>` for bug fixes
- `refactor/<short-description>` for refactoring
- `docs/<short-description>` for documentation

## Pull Request Process
1. Create a feature branch from `main`
2. Make your changes with clear, focused commits
3. Ensure all tests pass
4. Open a PR with a description of changes and a test plan
5. Request review from a team member

## Project Structure
```
├── backend/              # FastAPI + SQLAlchemy + Celery
│   ├── app/
│   │   ├── api/v1/       # API endpoints
│   │   ├── core/         # Config, database, security
│   │   ├── models/       # SQLAlchemy models
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── processing/   # Document extractors + AI interpreter
│   │   ├── generation/   # 3D building geometry + GLB export
│   │   └── tasks/        # Celery task definitions
│   └── tests/
├── frontend/             # React + Three.js
│   └── src/
│       ├── components/   # Reusable UI components
│       ├── features/     # Page-level feature components
│       ├── services/     # API client
│       ├── store/        # Zustand stores
│       └── types/        # TypeScript types
└── infrastructure/       # Docker, deployment configs
```

## Key Patterns
- **API endpoints** use FastAPI dependency injection for auth and database sessions
- **3D models** are generated server-side (trimesh) as GLB and loaded client-side via useGLTF
- **Document processing** is async via Celery tasks (upload -> extract -> AI interpret -> generate 3D)
- **State management** uses Zustand for UI state and React Query for server state

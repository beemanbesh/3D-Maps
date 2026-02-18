# 3D Interactive Development Visualization Platform
# Project Checklist — 26-34 Week Plan (5.5 FTE)

**Last Updated:** February 15, 2026
**Team:** 1.5 FE, 1.5 BE, 1.0 3D Dev, 0.5 AI/ML, 0.5 DevOps, 0.5 Design

---

## Legend
- [x] Complete
- [~] Partially complete / needs polish
- [ ] Not started

---

## Phase 1: MVP — Basic Visualization (Weeks 1-10)
> **Goal:** Single PDF upload, simple box extrusion, web viewer, basic map

### 1.1 Infrastructure & Architecture (DevOps + BE)
- [x] Project repository structure (frontend/, backend/, infrastructure/)
- [x] Docker Compose multi-service setup (Postgres, Redis, MinIO, API, Celery, Frontend)
- [x] Dockerfile.backend + Dockerfile.frontend
- [x] PostgreSQL 15 + PostGIS 3.4 database setup
- [x] Redis 7.2 for Celery broker/backend
- [x] MinIO (S3-compatible) object storage
- [x] Environment variable configuration (.env.example, pydantic-settings)
- [x] Alembic migration setup
- [x] CI/CD pipeline (GitHub Actions — lint, type-check, test, Docker build)
- [x] Staging environment deployment (docker-compose.staging.yml with nginx reverse proxy, health checks, replicas, resource limits)
- [x] Automated linting & formatting checks (pre-commit hooks: black, ruff, eslint, file hygiene)

### 1.2 Backend Core (BE)
- [x] FastAPI application scaffold with lifespan
- [x] SQLAlchemy 2.0 async ORM setup
- [x] Database models: User, Project, Building, Document
- [x] Pydantic schemas for request/response validation
- [x] CORS middleware configuration
- [x] Health check endpoint
- [x] API router aggregation (auth, projects, documents, buildings)

### 1.3 Project Management API (BE)
- [x] POST /projects — Create project
- [x] GET /projects — List projects
- [x] GET /projects/{id} — Get project with buildings & documents
- [x] PUT /projects/{id} — Update project
- [x] DELETE /projects/{id} — Delete project
- [~] Owner association (hardcoded user ID, no real auth — Phase 4)

### 1.4 Document Upload & Storage (BE)
- [x] POST /documents/projects/{id}/upload — Upload with file type validation
- [x] File type validation (PDF, JPG, PNG, TIFF, DWG, DXF, XLSX, CSV, GeoJSON)
- [x] File size validation (100MB limit)
- [x] Upload to S3/MinIO storage
- [x] GET /documents/{id}/file — File proxy from MinIO
- [x] DELETE /documents/{id} — Delete document + S3 cleanup
- [x] Document DB record creation with processing_status

### 1.5 Basic 3D Generation (3D Dev)
- [x] BuildingGenerator class with footprint extrusion (trimesh)
- [x] Floor plate generation at each level
- [x] Flat roof support (top of extrusion)
- [x] GLBExporter — export Scene to GLB bytes
- [x] GLBExporter — export Scene to GLB file

### 1.6 Web Viewer — MVP (FE)
- [x] React Three Fiber canvas setup
- [x] PerspectiveCamera with default position
- [x] OrbitControls with damping
- [x] WASD + Arrow key camera movement
- [x] Q/E (Space/Shift) vertical movement
- [x] Ambient + directional lighting with shadows
- [x] Shadow material ground plane
- [x] Grid overlay (toggle-able)
- [x] Sky component with sun position
- [x] Environment preset (city IBL)
- [x] Simple box building rendering (gray)
- [x] Building click selection
- [x] Building hover highlighting
- [x] Building label on hover/select (name + floor count)
- [x] Suspense fallback for model loading
- [x] Non-overlapping grid layout for multiple buildings

### 1.7 Frontend Project Management (FE)
- [x] Project list page with create/delete
- [x] Project detail page with sidebar
- [x] File upload component (drag & drop with react-dropzone)
- [x] Upload progress indicators
- [x] Add Building modal
- [x] Building list with 3D Ready badges
- [x] "Open 3D Viewer" navigation link
- [x] Axios API client with auth interceptor
- [x] React Query for server state
- [x] Zustand stores (project, viewer, upload)

### 1.8 Basic Map Integration (FE)
- [x] Mapbox GL JS dependency installed (v3.8.0)
- [~] Static 2D map layer behind 3D scene (implemented but needs Mapbox token to function)
- [x] Geocoding / address search (Mapbox Geocoding API with autocomplete on project create form)
- [x] Project location pin on map (location shown on project cards + detail page)

---

## Phase 2: Enhanced Processing (Weeks 11-18)
> **Goal:** AI extraction, facade details, satellite imagery, shadows

### 2.1 Document Processing Pipeline (BE + AI/ML)
- [x] Celery task: process_document — full pipeline orchestration
- [x] Celery task: generate_3d_model — geometry + GLB + S3 upload
- [x] Sync SQLAlchemy session for Celery tasks
- [x] S3 download helper for Celery tasks
- [x] S3 upload helper for GLB models
- [x] Document status transitions: pending → processing → completed/failed
- [x] Auto-trigger processing on document upload
- [x] POST /documents/{id}/process — Re-trigger processing
- [x] GET /documents/status/{job_id} — Real Celery AsyncResult status

### 2.2 Document Extractors (BE + AI/ML)
- [x] extract_from_file() router by file type
- [x] PDF extractor (PyMuPDF — text + images at 300 DPI)
- [x] Image extractor (OpenCV edge/line detection + Tesseract OCR)
- [x] CAD extractor (ezdxf — layers, polylines, dimensions)
- [x] Spreadsheet extractor (pandas — coordinate & dimension columns)
- [x] GeoJSON extractor (polygon features + properties)
- [x] ExtractionResult standardized container
- [ ] DWG support (ezdxf handles DXF, DWG needs ODA converter)
- [x] Multi-page PDF floor plan detection (which pages are floor plans vs. text — OpenCV heuristics: line density, edge density, text ratio, keyword matching)

### 2.3 AI Interpretation (AI/ML)
- [x] ClaudeInterpreter class with Anthropic client
- [x] interpret_floor_plan() — image analysis for dimensions & rooms
- [x] interpret_elevation() — height, floor count, roof type, facades
- [x] extract_dimensions_from_text() — text-based spec extraction
- [x] validate_extracted_data() — consistency checking
- [x] JSON response parsing with markdown fence stripping
- [x] Normalization function merging extraction + interpretation
- [x] Multi-image interpretation (all pages, not just first — loops all images, tries floor plan then elevation)
- [x] Confidence thresholds — skip low-confidence AI results (CONFIDENCE_THRESHOLD=0.3, per-building filtering, ai_confidence in specs + frontend badge)
- [x] Manual correction UI for AI-extracted dimensions (inline edit mode in building info panel)
- [x] Prompt refinement & few-shot examples for better accuracy (all 3 interpretation methods enhanced)

### 2.4 Enhanced 3D Models (3D Dev + FE)
- [x] Gabled roof generation (backend trimesh)
- [x] Hipped/pyramid roof generation (backend trimesh)
- [x] Procedural window generation on facades (backend trimesh)
- [x] Client-side procedural windows on all 4 facades
- [x] Client-side floor line dividers
- [x] Client-side gabled roof (BufferGeometry)
- [x] Client-side hipped roof (BufferGeometry)
- [x] Warm color palette per building (8 colors)
- [x] Three rendering paths: GLB / Procedural / Fallback
- [x] GLB loading via useGLTF + proxy endpoint
- [x] GET /buildings/{id}/model/file — GLB proxy from MinIO
- [x] PBR materials on server-generated models (concrete, glass, brick, metal, wood, roof_tile, floor_slab)
- [x] Texture mapping on facades (procedural CanvasTexture: brick, concrete, glass, metal, wood — tileable 256x256, cached, UV-tiled per building size)
- [x] Door placement (longest facade edge, centered, wood material)
- [x] Balcony/terrace extrusion (backend + frontend procedural balconies on upper floors)
- [x] Architectural details (cornices — backend perimeter ledge + frontend roofline box geometry)

### 2.5 Satellite Imagery & Map (FE)
- [x] MapboxBackground component
- [x] Satellite / Streets / Terrain style switching
- [x] Non-interactive map (camera from Three.js)
- [x] Off/On toggle for map layer
- [x] Canvas alpha transparency when map active
- [x] Sky & Grid hidden when map active
- [x] Shadow plane transparent over map
- [x] Mapbox 3D terrain elevation (raster-dem source, terrain exaggeration 1.5, pitched camera, auto-toggle on style change)
- [x] Sync Three.js camera with Mapbox camera (geo-referenced — meters→lat/lng conversion, zoom from height, bearing from direction, CustomEvent bridge)
- [x] Custom Mapbox 3D layer for buildings (CustomLayerInterface with Three.js rendering in Mapbox GL pipeline, MercatorCoordinate geo-referencing, building box meshes + gabled roofs)

### 2.6 Shadow Simulation (FE)
- [x] Directional light with shadow maps (2048x2048)
- [x] Time-of-day slider (6:00-20:00)
- [x] Sun position calculation from time
- [x] Shadow toggle in controls
- [x] Date selector for seasonal sun angle variation (astronomical solar position from hour + day-of-year + latitude)
- [x] Shadow overlay visualization on surrounding areas (64x64 raycasted heatmap, 13 hourly sun positions, DataTexture overlay)
- [x] Automatic sun position from project coordinates (lat/lng passed to SunLight via calculateSunPosition)

### 2.7 Frontend Processing UX (FE)
- [x] Document list with processing status badges (pending/processing/completed/failed)
- [x] Animated spinner for processing documents
- [x] Auto-refresh (3s polling) while documents are processing
- [x] Cache invalidation on upload complete
- [x] File type icons (PDF, image, spreadsheet)
- [x] File size formatting
- [x] Document delete with confirmation
- [x] Processing count badge on Documents section
- [x] Processing progress bar (animated shimmer bar with status text)
- [x] Toast notifications on processing complete/failed

### 2.8 Viewer Controls (FE)
- [x] Camera mode selector (Orbit / Walk / Fly)
- [x] Layer toggles (Buildings, Landscaping, Roads, Grid, Measurements)
- [x] Shadow toggle + time slider
- [x] Map layer selector (Off / Satellite / Streets / Terrain)
- [x] Info panel with building details on click
- [x] Reference image display on ground plane
- [x] Camera mode differentiation (Walk: ground-locked pointer-lock; Fly: 6DOF pointer-lock; both with collision)
- [x] Preset camera views (aerial, street, 45°, front) with smooth animated transitions
- [x] Mini-map for spatial orientation (SVG overhead view with camera position + direction indicator)
- [x] Legend panel (collapsible, shows phase colors, measurement types, context buildings)

---

## Phase 3: Advanced Features (Weeks 19-28)
> **Goal:** LOD, phasing, measurements, collaboration, context buildings

### 3.1 Level of Detail System (3D Dev + FE)
- [x] LODGenerator class (backend — 4 LOD levels with quadric decimation)
- [x] Wire LOD generation into generate_3d_model task
- [x] Store LOD variants as separate GLB files in S3
- [x] Frontend LOD switching based on camera distance
- [x] LOD-aware model file proxy endpoint (?lod=N query param)
- [x] Progressive loading (starts at highest LOD, preloads better detail, swaps when loaded)
- [x] Performance monitoring (FPS counter, draw calls, triangles — toggle in controls)

### 3.2 Construction Phasing (BE + FE)
- [x] construction_phase field on Building model
- [x] Phase data model (construction_phases JSONB on Project: name, dates, color)
- [x] Timeline scrubber UI component (slider + phase buttons)
- [x] Phase-specific building visibility (filter by activePhase)
- [x] Animated transitions between phases (opacity + scale with smoothstep in useFrame)
- [x] Phase metadata panel (dates, units per phase — shown in ViewerControls phase panel)
- [x] Before/after comparison mode (draggable split view divider, screen-space phase determination)

### 3.3 Measurement Tools (FE)
- [x] Distance measurement between two 3D points
- [x] Measurement display overlays (labels in 3D space with distance)
- [x] Clear measurements button
- [x] Area calculation (polygon measurement with 3+ points, Shoelace formula)
- [x] Height measurement (click building to measure ground-to-top)
- [x] Angle measurement for setbacks (3-point: start, vertex, end with arc + degree display)
- [x] Unit switching (metric m/m² ↔ imperial ft/ft²)

### 3.4 Advanced Camera Modes (FE)
- [x] First-person / walk mode (ground-level, pointer lock, WASD)
- [x] Fly-through mode (free 6DOF, pointer lock, WASD + Q/E)
- [x] Collision detection for walk/fly modes (raycasting with 1.5m clearance buffer)
- [x] Camera path recording & playback (keyframe capture, smoothstep interpolation, Record/Play/Stop UI)
- [x] Preset views (aerial, street level, 45°, front)
- [x] Smooth animated transitions between views (lerp + ease-out cubic)

### 3.5 Material Library (3D Dev)
- [x] PBR material definitions (glass, brick, concrete, metal, wood — MATERIALS dict in building_generator.py + frontend MATERIAL_COLORS)
- [x] Material texture atlas / library (cached CanvasTexture system with 6 material types, tileable patterns, repeat-aware UV tiling)
- [x] Material assignment UI (select facade material per building — picker in building info panel, PBR properties update)
- [x] Procedural material generation (tileable textures — CanvasTexture brick/concrete/glass/metal/wood patterns)
- [x] Green roof / vegetation shader (CanvasTexture with vegetation noise, flowers, leaf clusters; GreenRoofOverlay component with parapet walls; material picker option)

### 3.6 Context Buildings from OSM (3D Dev + BE)
- [x] Fetch nearby building footprints from OpenStreetMap / Overpass API
- [x] Estimate building heights from OSM tags
- [x] Generate simple extruded context buildings (THREE.ExtrudeGeometry)
- [x] Render context buildings as low-detail gray volumes
- [x] Toggle context buildings visibility (showExistingBuildings)

### 3.7 Site Context Integration (3D Dev + FE)
- [x] Terrain generation from DEM / elevation data (via Mapbox 3D terrain-RGB tiles, raster-dem source with hillshade)
- [x] Road network generation from street data (OSM Overpass API, flat ribbon geometry, highway-type colors + widths)
- [x] Landscaping objects (trees, green spaces — procedural conifer/deciduous trees + green patches, toggle-able)
- [x] Site furniture (benches, lighting, signage) — procedural benches, light poles, bollards with seeded placement
- [x] Parking lot / hardscaping rendering (asphalt surface, striped parking spaces)

### 3.8 Multi-User Collaboration (BE + FE)
- [x] WebSocket server for real-time updates (FastAPI WebSocket, ConnectionManager, per-project rooms)
- [x] Presence indicators (who else is viewing — colored avatars in top bar)
- [x] Real-time building edits broadcast (toast notifications + query invalidation)
- [x] Shared camera position (follow mode — click presence avatar to follow, smooth lerp, throttled 10fps broadcast)
- [x] Comments / annotations on 3D objects (click-to-place markers with text, resolve/delete, backend CRUD API)
- [x] Activity feed / change log (ActivityLog model, auto-logging on upload/create, sidebar feed on ProjectViewPage)

---

## Phase 4: Production Ready (Weeks 29-34)
> **Goal:** Auth, export, mobile, testing, deployment

### 4.1 Authentication & Authorization (BE)
- [x] JWT token generation (access + refresh)
- [x] Password hashing (bcrypt via passlib)
- [x] POST /auth/register — User registration
- [x] POST /auth/login — Token-based login
- [x] POST /auth/refresh — Refresh token endpoint
- [x] GET /auth/me — Current user info
- [x] Role field on User model (viewer/editor/admin)
- [x] Role-based access control (RBAC): require_role dependency
- [x] Optional auth on project endpoints (backwards-compatible)
- [x] Owner-based project filtering & authorization
- [x] Frontend login/register pages
- [x] Frontend auth store (Zustand)
- [x] Frontend 401 interceptor with auto-refresh
- [x] Layout user menu (sign in/out)
- [x] OAuth2 support (Google, Microsoft — backend oauth.py with auth URL + callback endpoints, frontend OAuthButtons component, config settings)
- [x] Project-level permissions (owner, collaborator, viewer — reusable check_project_permission dependency, owner/editor/viewer hierarchy, enforced on all CRUD endpoints)
- [x] Enforce strict auth on all protected endpoints (documents: upload, process, delete; buildings: create, update)

### 4.2 Project Sharing & Permissions (BE + FE)
- [x] ProjectShare model (project_id, user_id, email, permission, invite_token, is_public_link)
- [x] Share project by email invitation (POST /shares/projects/{id}/shares)
- [x] Permission levels (viewer, editor)
- [x] Public share link generation + revocation
- [x] Shared project list view (projects list includes shared projects)
- [x] ShareModal UI (email invite, public link, copy, revoke)
- [x] SharedProjectPage (view project via public link token)
- [x] Permission enforcement for shared editors vs viewers (editor-only for write endpoints)

### 4.3 Export Capabilities (FE + BE)
- [x] Screenshot export (canvas.toDataURL with preserveDrawingBuffer)
- [x] GLB model download for individual buildings (via proxy endpoint)
- [x] High-resolution render export (1x/2x/4x screenshot dropdown, offscreen canvas upscaling)
- [x] Video recording of fly-through (MediaRecorder API, canvas.captureStream 30fps, WebM/VP9)
- [x] Full scene export as glTF (GLTFExporter, binary GLB download)
- [x] PDF report generation (fpdf2, buildings table, documents table, phases, project summary)

### 4.4 Mobile-Responsive Interface (FE + Design)
- [x] Responsive layout for project list / detail pages
- [x] Touch-friendly 3D controls (OrbitControls native touch support)
- [x] Mobile viewer controls panel (collapsible with Settings toggle)
- [x] Responsive info panel (bottom sheet on mobile)
- [x] Touch-friendly file upload (responsive dropzone)
- [x] Mobile navigation (hamburger menu)
- [x] Responsive modals (bottom sheet on mobile)
- [x] Walk/Fly modes disabled on touch devices (no pointer lock)
- [x] Progressive Web App (PWA) support (manifest, service worker, offline caching)

### 4.5 Performance & Monitoring (DevOps + BE)
- [x] Sentry DSN configuration (ready but needs key)
- [x] Sentry error tracking integration (frontend @sentry/react + ErrorBoundary, backend sentry-sdk[fastapi] with environment/release)
- [x] API response time monitoring / metrics endpoint (MetricsMiddleware + GET /metrics with avg/p95 response times)
- [x] Processing queue depth monitoring (Celery inspect in /metrics endpoint: active, reserved, scheduled)
- [x] Frame rate monitoring in viewer (FPS counter, draw calls, triangles in ViewerControls)
- [x] Performance budgets (bundle size: JS <2MB, chunk <800KB, CSS <100KB; runtime: FPS >=30, triangles <500k, draw calls <200; CI check-budget step)
- [x] Database query optimization (indexes on all FK columns, selectinload for project queries)
- [x] CDN setup for static assets & GLB models (CloudFront distribution in terraform/s3.tf with OAI, CORS, lifecycle rules)

### 4.6 Testing (All)
- [x] pytest configuration (pytest.ini, conftest with fixtures)
- [x] Backend unit tests — security utilities (password hashing, JWT)
- [x] Backend unit tests — schema validation (all Pydantic schemas)
- [x] Backend integration tests — health check & app setup
- [x] Backend integration tests — auth API endpoints (register, login, refresh, /me)
- [x] Frontend test configuration (vitest in vite.config.ts, test-setup.ts)
- [x] Frontend unit tests — viewer store (settings, selection, measurements)
- [x] Frontend unit tests — auth store (login, logout, token cleanup)
- [x] Frontend unit tests — upload store (add, update, remove, clear)
- [x] Backend unit tests (extractors, normalization, generators — 17 tests in test_generators.py)
- [x] Frontend integration tests (LoginPage 6 tests, collaboration hook 9 tests)
- [x] End-to-end tests with Playwright (auth, projects, viewer — 3 spec files with chromium, screenshots on failure)
- [x] 3D rendering visual regression tests (Playwright visual-regression.spec.ts with toHaveScreenshot, 2% pixel tolerance, canvas/WebGL wait helpers)
- [x] Load testing (k6 load + spike tests — ramp to 100/200 VUs, p95 thresholds, health/projects/detail endpoints)
- [ ] File format compatibility testing (various PDF/CAD samples)

### 4.7 Documentation (All)
- [x] README.md with architecture overview & quick start
- [x] Technical specification document (docx_extracted.txt)
- [x] API documentation (OpenAPI/Swagger — all schemas with Field descriptions, endpoint docstrings, app description with auth instructions)
- [x] Frontend component documentation (Storybook — main.ts + preview.ts config, Button/ViewerControls/ProjectCard stories)
- [x] Deployment guide (docs/DEPLOYMENT.md — Docker, env vars, production considerations)
- [x] User guide / tutorial (docs/USER_GUIDE.md — getting started, projects, document processing, 3D viewer, collaboration, exports)
- [x] Architecture decision records (ADRs — 5 records: R3F rendering, Celery+Redis, Claude AI, WebSocket collaboration, procedural textures)
- [x] Contributing guidelines (CONTRIBUTING.md — setup, code style, branch naming, PR process, project structure)

### 4.8 Production Deployment (DevOps)
- [x] Docker Compose for development
- [x] Kubernetes manifests (k8s/ — namespace, postgres StatefulSet, redis, minio, backend+celery Deployments, frontend, ingress, configmap, secrets)
- [x] Terraform infrastructure-as-code (terraform/ — VPC, RDS PostgreSQL, ElastiCache Redis, S3+CloudFront, ECS Fargate, ALB, Route53, ACM)
- [x] Production database setup (managed PostgreSQL — RDS instance in terraform/database.tf with multi-AZ option, automated backups)
- [x] Production Redis setup (managed Redis — ElastiCache in terraform/redis.tf)
- [x] Production S3 / CDN setup (S3 bucket + CloudFront distribution in terraform/s3.tf with versioning, encryption, lifecycle rules)
- [x] SSL/TLS certificates (ACM certificate with DNS validation in terraform/dns.tf)
- [x] Domain & DNS configuration (Route53 hosted zone + A record alias in terraform/dns.tf)
- [x] Blue-green or rolling deployment strategy (docs/DEPLOYMENT_STRATEGY.md, scripts/deploy-blue-green.sh + deploy-k8s.sh, k8s/blue-green/ manifests with slot labeling + traffic switching)
- [x] Backup & disaster recovery plan (docs/BACKUP_DR.md + scripts/backup-postgres.sh, backup-minio.sh, restore-postgres.sh — RPO/RTO targets, DR scenarios)
- [x] Secrets management (docs/SECRETS_MANAGEMENT.md + scripts/validate-env.sh, rotate-secrets.sh + k8s/external-secrets.yaml)

---

## Summary by Status

| Phase | Total Items | Done | Partial | Remaining |
|-------|------------|------|---------|-----------|
| **Phase 1: MVP** | 48 | 47 | 1 | 0 |
| **Phase 2: Enhanced** | 63 | 62 | 0 | 1 |
| **Phase 3: Advanced** | 40 | 40 | 0 | 0 |
| **Phase 4: Production** | 55 | 54 | 0 | 1 |
| **TOTAL** | **206** | **203** | **1** | **2** |

**Overall Progress: ~99% complete**

**Remaining (require external dependencies):**
- DWG file support (requires ODA File Converter binary — not freely distributable)
- File format compatibility testing (requires diverse sample PDF/CAD files)

**Last Updated:** February 16, 2026

---

## Work Remaining

Only 2 items remain, both requiring external dependencies:

| Item | Blocker |
|------|---------|
| DWG file support | Requires ODA File Converter binary (proprietary, not freely distributable) |
| File format compatibility testing | Requires diverse sample PDF/CAD/DXF files for test matrix |

All other items across all roles (Frontend, Backend, 3D Dev, AI/ML, DevOps, Design) are complete.

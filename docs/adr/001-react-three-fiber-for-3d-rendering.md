# ADR-001: React Three Fiber for 3D Rendering

**Status:** Accepted
**Date:** 2025-12-01
**Decision Makers:** Engineering Team

## Context

The platform requires an interactive 3D visualization engine that can render architectural buildings in a web browser with features like orbit controls, first-person navigation, measurements, shadow simulation, and material assignment. The rendering must integrate with a React frontend and support dynamic data updates from the backend.

### Options Considered

1. **React Three Fiber (@react-three/fiber)** — React renderer for Three.js
2. **Raw Three.js** — Direct Three.js with imperative API
3. **Babylon.js** — Alternative WebGL engine with built-in UI
4. **CesiumJS** — Geospatial 3D engine

## Decision

We chose **React Three Fiber** (R3F) as the 3D rendering layer.

## Rationale

- **React integration:** R3F provides a declarative, component-based API that maps naturally to React's paradigm. Building meshes, lights, and controls are expressed as JSX, enabling composition, props-driven updates, and hook-based state management.
- **Ecosystem:** The `@react-three/drei` library provides ready-made components (OrbitControls, Sky, Environment, Grid, Html overlays, useGLTF) that significantly reduced development time.
- **Three.js foundation:** R3F is a thin wrapper over Three.js, giving full access to the underlying WebGL API when needed (custom shaders, BufferGeometry, CanvasTexture).
- **State management:** Works naturally with Zustand for viewer state (camera mode, settings, selections) and React Query for server data.
- **Performance:** R3F's reconciler batches updates efficiently. Combined with `useFrame` hooks, we achieve smooth 60fps rendering with LOD switching and collision detection.

### Why Not Others

- **Raw Three.js** would require manual DOM lifecycle management and break the React data flow pattern used everywhere else.
- **Babylon.js** has a larger bundle size and its own UI system that would conflict with our Tailwind CSS + React UI.
- **CesiumJS** is optimized for geospatial globe rendering, which is overkill for our building-scale scenes.

## Consequences

### Positive

- Rapid feature development — new 3D features (measurements, annotations, shadow study) are added as React components
- Hot module reload works with 3D scene changes during development
- Easy to compose complex scenes from reusable building blocks (BuildingMesh, GabledRoof, ProceduralWindows)

### Negative

- Bundle size includes Three.js (~150KB gzipped) plus R3F (~15KB) and drei (~50KB)
- Developers need to understand both React and Three.js concepts (scene graph, materials, camera)
- Some Three.js patterns (imperative animation loops) require `useRef` + `useFrame` rather than pure declarative React

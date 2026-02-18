# ADR-005: Procedural Textures Over Pre-Baked Assets

**Status:** Accepted
**Date:** 2026-02-15
**Decision Makers:** Engineering Team

## Context

Building facades need visual material differentiation (brick, concrete, glass, metal, wood, green roof). The texture system must support both client-side procedural buildings and server-generated GLB models, with the ability to switch materials at runtime via the material picker UI.

### Options Considered

1. **Procedural CanvasTexture** — Generate tileable patterns programmatically using Canvas2D API
2. **Pre-baked texture images** — Ship static PNG/JPG texture files as assets
3. **Shader-based materials** — Custom GLSL fragment shaders for each material
4. **KTX2/Basis compressed textures** — Compressed GPU texture format for bandwidth efficiency

## Decision

We chose **procedural CanvasTexture** generation with a caching layer.

## Rationale

- **Zero bandwidth cost:** Textures are generated on the client at runtime. No texture images need to be downloaded, stored, or served from CDN.
- **Resolution-independent:** Since patterns are drawn programmatically, they can be generated at any resolution without pixelation. We use 256x256 as a good balance of quality vs. memory.
- **Dynamic tiling:** The `getProceduralTexture()` function accepts tile repeat counts based on building dimensions, ensuring patterns scale correctly regardless of building size.
- **Instant material switching:** When a user changes a building's facade material, a new texture is generated and cached. No network round-trip needed.
- **Small code footprint:** Each material pattern (brick grid, concrete speckle, glass panels, metal brushed, wood grain, green roof vegetation) is 20-40 lines of Canvas2D drawing code.

### Why Not Others

- **Pre-baked textures** would require 6+ image files (one per material), adding ~500KB-2MB to the initial bundle or requiring lazy loading infrastructure.
- **Custom GLSL shaders** would bypass Three.js's material system, complicating shadow rendering, environment mapping, and the existing PBR pipeline.
- **KTX2 textures** are the right choice for production optimization but add build complexity (texture compression toolchain) that's premature for our current scale.

## Consequences

### Positive

- No texture loading latency — materials appear instantly
- Texture cache (`textureCache` Map) prevents redundant generation
- Easy to add new material types — just add a `drawXPattern()` function
- Green roof texture includes organic elements (leaf clusters, small flowers) that would be harder with static textures
- Server-generated GLB models use PBR material properties (baseColor, metallic, roughness) while frontend adds visual detail via textures

### Negative

- Procedural patterns are simpler than photographic textures — a photo-realistic brick wall has more detail than our Canvas2D brick grid
- Canvas2D random noise is not seeded — patterns vary slightly across sessions (imperceptible in practice)
- No normal maps — surface detail is flat. Adding normal maps would require pre-baked textures or a compute shader pipeline.
- Memory usage: each 256x256 RGBA texture is ~256KB on the GPU. With 6 material types cached, that's ~1.5MB GPU memory.

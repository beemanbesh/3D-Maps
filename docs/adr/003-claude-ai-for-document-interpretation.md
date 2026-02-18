# ADR-003: Claude AI for Architectural Document Interpretation

**Status:** Accepted
**Date:** 2025-12-01
**Decision Makers:** Engineering Team

## Context

Converting architectural documents (floor plans, elevations, site plans) into structured building data requires understanding spatial relationships, dimension annotations, and architectural conventions. Traditional computer vision alone cannot reliably extract building dimensions, floor counts, and room layouts from diverse document formats.

### Options Considered

1. **Claude (Anthropic) vision API** — Multimodal LLM with image understanding
2. **GPT-4 Vision (OpenAI)** — Alternative multimodal LLM
3. **Custom CV pipeline** — OpenCV + Tesseract + rule-based extraction
4. **Google Document AI** — Managed document processing service

## Decision

We chose **Claude's vision API** (Anthropic) as the primary AI interpreter for architectural documents.

## Rationale

- **Architectural understanding:** Claude demonstrates strong ability to interpret floor plans, identify room boundaries, estimate dimensions from scale bars, and understand elevation drawings. Its reasoning about spatial relationships produces more accurate results than rule-based approaches.
- **Flexible output:** Claude can return structured JSON with building dimensions, room counts, roof types, and confidence scores — reducing post-processing complexity.
- **Multi-method interpretation:** We use three specialized prompts:
  - `interpret_floor_plan()` — extracts building footprint, rooms, dimensions from plan views
  - `interpret_elevation()` — extracts height, floor count, facade details from elevation views
  - `extract_dimensions_from_text()` — parses text specifications for building data
- **Confidence scoring:** Claude provides self-assessed confidence that we use for filtering (CONFIDENCE_THRESHOLD=0.3) and displaying to users.
- **Few-shot prompting:** Adding example inputs/outputs to prompts significantly improved extraction accuracy across diverse document styles.

### Why Not Others

- **GPT-4 Vision** showed comparable results but Claude's structured output format was more consistent for our JSON schema.
- **Custom CV pipeline** works for simple cases (edge detection, OCR) but cannot understand architectural context (e.g., differentiating structural walls from furniture, understanding scale annotations).
- **Google Document AI** is optimized for business documents (invoices, forms), not architectural drawings.

## Consequences

### Positive

- High accuracy on diverse architectural document formats with minimal custom code
- Graceful degradation — when AI results are low-confidence, we flag them and allow manual correction
- Prompt engineering is faster than training custom models
- Works with any image format without preprocessing

### Negative

- External API dependency — processing fails when Anthropic API is unavailable
- Per-document API cost (~$0.01-0.05 per interpretation depending on image size)
- Response latency (~3-8 seconds per image) adds to total processing time
- Non-deterministic — same document may produce slightly different results on repeated processing
- Requires ANTHROPIC_API_KEY environment variable to be configured

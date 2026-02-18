"""
AI-powered document interpretation using Anthropic Claude API.
Handles complex architectural document understanding and data extraction.
"""

import base64
import json
import logging
from typing import Any, Optional

import anthropic

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class ClaudeInterpreter:
    """Uses Claude API to interpret architectural documents and extract structured data."""

    def __init__(self):
        self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self.model = "claude-sonnet-4-20250514"

    async def interpret_floor_plan(
        self, image_data: bytes, context: Optional[dict] = None
    ) -> dict[str, Any]:
        """
        Analyze a floor plan image and extract building dimensions,
        room layouts, and spatial relationships.
        """
        b64_image = base64.standard_b64encode(image_data).decode("utf-8")

        system_prompt = """You are an expert architectural analyst. Analyze the provided floor plan image
and extract structured data. Return a JSON object with the following structure:
{
    "building_dimensions": {
        "width_meters": <number>,
        "depth_meters": <number>,
        "estimated_area_sqm": <number>
    },
    "rooms": [
        {
            "name": "<room name/type>",
            "area_sqm": <number>,
            "width_meters": <number>,
            "depth_meters": <number>
        }
    ],
    "features": {
        "doors": <count>,
        "windows": <count>,
        "stairs": <boolean>,
        "elevator": <boolean>
    },
    "scale": "<detected scale if visible>",
    "confidence": <0.0-1.0>,
    "notes": "<any relevant observations>"
}

Example output for a typical residential floor plan:
{
    "building_dimensions": {"width_meters": 12.5, "depth_meters": 9.0, "estimated_area_sqm": 112.5},
    "rooms": [
        {"name": "Living Room", "area_sqm": 25.0, "width_meters": 5.0, "depth_meters": 5.0},
        {"name": "Kitchen", "area_sqm": 12.0, "width_meters": 4.0, "depth_meters": 3.0},
        {"name": "Bedroom 1", "area_sqm": 15.0, "width_meters": 5.0, "depth_meters": 3.0},
        {"name": "Bathroom", "area_sqm": 6.0, "width_meters": 3.0, "depth_meters": 2.0}
    ],
    "features": {"doors": 5, "windows": 6, "stairs": false, "elevator": false},
    "scale": "1:100",
    "confidence": 0.82,
    "notes": "Clear dimension labels visible. Single-story residential layout."
}

Important: If dimensions are not labeled, estimate from the apparent scale and proportions.
Set confidence below 0.5 if you are guessing dimensions without clear labels.
Only return valid JSON, no other text."""

        context_text = ""
        if context:
            context_text = f"\nAdditional context: {json.dumps(context)}"

        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": b64_image,
                                },
                            },
                            {
                                "type": "text",
                                "text": f"Analyze this architectural floor plan and extract dimensions and layout data.{context_text}",
                            },
                        ],
                    }
                ],
            )

            response_text = message.content[0].text
            # Strip markdown code fences if present
            response_text = response_text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1]
                response_text = response_text.rsplit("```", 1)[0]

            return json.loads(response_text)

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Claude response as JSON: {e}")
            return {"error": "Failed to parse AI response", "confidence": 0.0}
        except Exception as e:
            logger.error(f"Claude API error: {e}")
            return {"error": str(e), "confidence": 0.0}

    async def interpret_elevation(
        self, image_data: bytes, context: Optional[dict] = None
    ) -> dict[str, Any]:
        """Analyze a building elevation drawing to extract height, floor count, and facade details."""
        b64_image = base64.standard_b64encode(image_data).decode("utf-8")

        system_prompt = """You are an expert architectural analyst. Analyze the provided building elevation
drawing and extract structured data. Return a JSON object with:
{
    "total_height_meters": <number>,
    "floor_count": <number>,
    "floor_height_meters": <number>,
    "roof_type": "<flat|gabled|hipped|mansard|shed>",
    "facade_materials": ["<material1>", "<material2>"],
    "window_pattern": {
        "windows_per_floor": <number>,
        "window_width_meters": <number>,
        "window_height_meters": <number>
    },
    "features": ["<balconies|cornices|pilasters|etc>"],
    "confidence": <0.0-1.0>,
    "notes": "<observations>"
}

Example output for a 4-story apartment building:
{
    "total_height_meters": 14.0,
    "floor_count": 4,
    "floor_height_meters": 3.0,
    "roof_type": "gabled",
    "facade_materials": ["brick", "concrete"],
    "window_pattern": {"windows_per_floor": 4, "window_width_meters": 1.2, "window_height_meters": 1.5},
    "features": ["balconies", "cornices"],
    "confidence": 0.78,
    "notes": "Red brick facade with concrete accents. Gabled roof with clay tiles."
}

Important: Estimate dimensions from apparent proportions (assume a person is ~1.8m tall, a door ~2.1m, a standard floor ~3m).
Set confidence below 0.5 if the image is unclear or you are heavily guessing.
Only return valid JSON."""

        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/png",
                                    "data": b64_image,
                                },
                            },
                            {
                                "type": "text",
                                "text": "Analyze this building elevation drawing and extract height, floors, and facade details.",
                            },
                        ],
                    }
                ],
            )

            response_text = message.content[0].text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1]
                response_text = response_text.rsplit("```", 1)[0]

            return json.loads(response_text)

        except Exception as e:
            logger.error(f"Elevation interpretation error: {e}")
            return {"error": str(e), "confidence": 0.0}

    async def extract_dimensions_from_text(
        self, text: str, context: Optional[dict] = None
    ) -> dict[str, Any]:
        """Extract building dimensions and specifications from document text."""
        system_prompt = """You are an expert at extracting building specifications from architectural documents.
Given the text content, extract all building-related dimensions and specifications.
Return a JSON object with:
{
    "buildings": [
        {
            "name": "<building identifier>",
            "height_meters": <number or null>,
            "floor_count": <number or null>,
            "floor_height_meters": <number or null>,
            "footprint_area_sqm": <number or null>,
            "total_area_sqm": <number or null>,
            "units": <number or null>,
            "use_type": "<residential|commercial|mixed|industrial>"
        }
    ],
    "site": {
        "total_area_sqm": <number or null>,
        "address": "<address if found>",
        "zoning": "<zoning if found>"
    },
    "confidence": <0.0-1.0>
}

Example output for a development spec sheet:
{
    "buildings": [
        {"name": "Building A", "height_meters": 24.0, "floor_count": 8, "floor_height_meters": 3.0, "footprint_area_sqm": 450, "total_area_sqm": 3600, "units": 32, "use_type": "residential"},
        {"name": "Building B", "height_meters": 12.0, "floor_count": 4, "floor_height_meters": 3.0, "footprint_area_sqm": 200, "total_area_sqm": 800, "units": null, "use_type": "commercial"}
    ],
    "site": {"total_area_sqm": 5000, "address": "123 Main St, Springfield", "zoning": "R3 Mixed Use"},
    "confidence": 0.9
}

Important: Extract ALL buildings mentioned in the text. Use null for unknown fields.
Convert imperial measurements to metric (1 ft = 0.3048 m, 1 sq ft = 0.0929 sq m).
Set confidence below 0.5 if the text is vague or ambiguous about dimensions.
Only return valid JSON."""

        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=2000,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": f"Extract building dimensions from this document text:\n\n{text[:8000]}",
                    }
                ],
            )

            response_text = message.content[0].text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1]
                response_text = response_text.rsplit("```", 1)[0]

            return json.loads(response_text)

        except Exception as e:
            logger.error(f"Text interpretation error: {e}")
            return {"error": str(e), "confidence": 0.0}

    async def validate_extracted_data(
        self, extracted: dict, source_type: str
    ) -> dict[str, Any]:
        """Cross-reference extracted data for consistency and flag anomalies."""
        system_prompt = """You are a quality control specialist for architectural data.
Review the extracted building data for consistency and flag any issues.
Return a JSON object with:
{
    "is_valid": <boolean>,
    "issues": ["<issue description>"],
    "corrections": {"<field>": <corrected_value>},
    "confidence": <0.0-1.0>
}
Only return valid JSON."""

        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=1000,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": f"Validate this extracted architectural data from a {source_type}:\n\n{json.dumps(extracted, indent=2)}",
                    }
                ],
            )

            response_text = message.content[0].text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1]
                response_text = response_text.rsplit("```", 1)[0]

            return json.loads(response_text)

        except Exception as e:
            logger.error(f"Validation error: {e}")
            return {"is_valid": True, "issues": [], "confidence": 0.0}

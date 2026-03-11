from datetime import datetime
from typing import Dict, List, Optional, Int

from pydantic import BaseModel, Field, field_validator


class BriefModel(BaseModel):
    """Validated briefing payload used for create/update and view modeling."""

    id: Optional[int] = Field(default=None, description="The id of the briefing")
    ticker: str = Field(..., description="The ticker symbol of the company (will be uppercased)")
    companyName: str = Field(..., description="The name of the company")
    analystName: str = Field(..., description="The name of the analyst")
    sector: str = Field(..., description="The sector of the company")
    summary: str = Field(..., description="The executive summary of the company")
    recommendation: str = Field(..., description="The recommendation for the company")
    keyPoints: List[str] = Field(..., description="Key points about the company (at least 2)")
    risks: List[str] = Field(..., description="Risks for the company (at least 1)")
    metrics: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description="Optional list of metrics as {name, value} with unique names",
    )
    generated: bool = Field(
        default=False, description="Whether an HTML report has been generated"
    )

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, v: str) -> str:
        """Normalize ticker to uppercase and strip whitespace."""
        value = (v or "").strip().upper()
        if not value:
            raise ValueError("ticker is required")
        return value

    @field_validator("keyPoints")
    @classmethod
    def ensure_min_keypoints(cls, v: List[str]) -> List[str]:
        """Ensure at least two key points are provided."""
        points = [p for p in v if p and p.strip()]
        if len(points) < 2:
            raise ValueError("at least 2 keyPoints are required")
        return points

    @field_validator("risks")
    @classmethod
    def ensure_min_risks(cls, v: List[str]) -> List[str]:
        """Ensure at least one risk is provided."""
        risks = [r for r in v if r and r.strip()]
        if len(risks) < 1:
            raise ValueError("at least 1 risk is required")
        return risks

    @field_validator("metrics")
    @classmethod
    def ensure_unique_metric_names(
        cls, v: Optional[List[Dict[str, str]]]
    ) -> Optional[List[Dict[str, str]]]:
        """Ensure metric names are unique within a briefing."""
        if v is None:
            return None
        seen: set[str] = set()
        cleaned: List[Dict[str, str]] = []
        for metric in v:
            name = (metric.get("name") or "").strip()
            value = (metric.get("value") or "").strip()
            if not name:
                raise ValueError("each metric must have a non-empty name")
            if name in seen:
                raise ValueError("metric names must be unique within a briefing")
            seen.add(name)
            cleaned.append({"name": name, "value": value})
        return cleaned
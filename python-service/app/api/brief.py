from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.base import BriefModel
from app.services.brief_service import (
    create_brief,
    get_brief,
    get_briefs,
    store_generated_report,
    update_brief,
)
from app.services.report_formatter import ReportFormatter

router = APIRouter(prefix="/briefings", tags=["briefings"])
report_formatter = ReportFormatter()


@router.post("", response_model=BriefModel, status_code=status.HTTP_201_CREATED)
def create_brief_handler(
    payload: BriefModel, session: Session = Depends(get_db)
) -> BriefModel:
    """Create a new briefing from structured JSON input."""
    briefing = create_brief(session, payload)
    # Build the response view model from normalized tables (points + metrics).
    return report_formatter._build_view_model(briefing)  # type: ignore[attr-defined]


@router.get("/{brief_id}", response_model=BriefModel)
def get_brief_handler(
    brief_id: int, session: Session = Depends(get_db)
) -> BriefModel:
    """Retrieve the stored structured data for a single briefing."""
    briefing = get_brief(session, brief_id)
    if briefing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Briefing not found")
    return report_formatter._build_view_model(briefing)  # type: ignore[attr-defined]


@router.get("", response_model=List[BriefModel])
def get_briefs_handler(session: Session = Depends(get_db)) -> List[BriefModel]:
    """List all briefings."""
    briefings = get_briefs(session)
    return [report_formatter._build_view_model(b) for b in briefings]  # type: ignore[attr-defined]


@router.put("/{brief_id}", response_model=BriefModel)
def update_brief_handler(
    brief_id: int,
    payload: BriefModel,
    session: Session = Depends(get_db),
) -> BriefModel:
    """Update an existing briefing."""
    briefing = update_brief(session, brief_id, payload)
    return report_formatter._build_view_model(briefing)  # type: ignore[attr-defined]


@router.post("/{brief_id}/generate", status_code=status.HTTP_202_ACCEPTED)
def generate_report_handler(
    brief_id: int, session: Session = Depends(get_db)
) -> dict:
    """
    Generate an HTML report for an existing briefing.

    This reads the stored data, transforms it via the formatter, renders HTML,
    and marks the briefing as generated.
    """
    db_brief = get_brief(session, brief_id)
    if db_brief is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Briefing not found")

    html = report_formatter.render_base(db_brief)
    updated_brief = store_generated_report(session, brief_id, html)
    return {"id": updated_brief.id, "generated": updated_brief.generated}


@router.get("/{brief_id}/html", response_class=Response)
def get_report_html_handler(
    brief_id: int, session: Session = Depends(get_db)
) -> Response:
    """
    Return the previously generated HTML report for a briefing.

    If the briefing has not been generated yet, respond with 404.
    """
    db_brief = get_brief(session, brief_id)
    if db_brief is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Briefing not found")
    if not db_brief.generated or not db_brief.report_html:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report has not been generated for this briefing",
        )
    return Response(content=db_brief.report_html, media_type="text/html")
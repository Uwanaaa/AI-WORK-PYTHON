from typing import List

from sqlalchemy.orm import Session

from app.db.base import Briefing, BriefingMetric, BriefingPoint
from app.models.base import BriefModel


def create_brief(session: Session, brief: BriefModel) -> Briefing:
    """Persist a new briefing and its points/metrics from validated input."""
    db_brief = Briefing(
        ticker=brief.ticker,
        companyName=brief.companyName,
        analystName=brief.analystName,
        sector=brief.sector,
        summary=brief.summary,
        recommendation=brief.recommendation,
        generated=False,
        report_html=None,
    )
    session.add(db_brief)
    session.flush()

    for idx, text in enumerate(brief.keyPoints):
        session.add(
            BriefingPoint(
                briefing_id=db_brief.id, kind="key", text=text, position=idx
            )
        )
    for idx, text in enumerate(brief.risks):
        session.add(
            BriefingPoint(
                briefing_id=db_brief.id, kind="risk", text=text, position=idx
            )
        )
    if brief.metrics:
        for metric in brief.metrics:
            session.add(
                BriefingMetric(
                    briefing_id=db_brief.id,
                    name=metric["name"],
                    value=metric["value"],
                )
            )

    session.commit()
    session.refresh(db_brief)
    return db_brief


def get_brief(session: Session, brief_id: int) -> Briefing | None:
    """Fetch a single briefing by id with its related points and metrics."""
    return (
        session.query(Briefing)
        .filter(Briefing.id == brief_id)
        .options()
        .first()
    )


def get_briefs(session: Session) -> List[Briefing]:
    """Return all briefings (without eager-loading points/metrics)."""
    return session.query(Briefing).all()


def update_brief(session: Session, brief_id: int, brief: BriefModel) -> Briefing:
    """Replace a briefing's structured content and its points/metrics."""
    db_brief = get_brief(session, brief_id)
    if db_brief is None:
        raise ValueError(f"Brief with id {brief_id} not found")

    db_brief.ticker = brief.ticker
    db_brief.companyName = brief.companyName
    db_brief.analystName = brief.analystName
    db_brief.sector = brief.sector
    db_brief.summary = brief.summary
    db_brief.recommendation = brief.recommendation

    # Clear and reinsert points/metrics for simplicity.
    session.query(BriefingPoint).filter(
        BriefingPoint.briefing_id == db_brief.id
    ).delete()
    session.query(BriefingMetric).filter(
        BriefingMetric.briefing_id == db_brief.id
    ).delete()

    for idx, text in enumerate(brief.keyPoints):
        session.add(
            BriefingPoint(
                briefing_id=db_brief.id, kind="key", text=text, position=idx
            )
        )
    for idx, text in enumerate(brief.risks):
        session.add(
            BriefingPoint(
                briefing_id=db_brief.id, kind="risk", text=text, position=idx
            )
        )
    if brief.metrics:
        for metric in brief.metrics:
            session.add(
                BriefingMetric(
                    briefing_id=db_brief.id,
                    name=metric["name"],
                    value=metric["value"],
                )
            )

    session.commit()
    session.refresh(db_brief)
    return db_brief


def store_generated_report(session: Session, brief_id: int, html: str) -> Briefing:
    """Mark a briefing as generated and persist the rendered HTML."""
    db_brief = get_brief(session, brief_id)
    if db_brief is None:
        raise ValueError(f"Brief with id {brief_id} not found")

    db_brief.generated = True
    db_brief.report_html = html
    session.commit()
    session.refresh(db_brief)
    return db_brief
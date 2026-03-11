from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.db.base import Briefing, BriefingMetric, BriefingPoint
from app.models.base import BriefModel

_TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "templates"


class ReportFormatter:
    """
    Service responsible for transforming stored briefing records into
    a template-friendly view model and rendering HTML.
    """

    def __init__(self) -> None:
        self._env = Environment(
            loader=FileSystemLoader(str(_TEMPLATE_DIR)),
            autoescape=select_autoescape(
                enabled_extensions=("html", "xml"), default_for_string=True
            ),
        )

    def _build_view_model(self, briefing: Briefing) -> BriefModel:
        """
        Transform a Briefing ORM instance into a validated view model.

        This is where formatting concerns (sorting, grouping, normalization)
        can be applied before passing data to the template.
        """
        # Manually assemble the structured view from normalized tables.
        key_points = [
            p.text
            for p in sorted(
                (pt for pt in briefing.points if pt.kind == "key"),
                key=lambda p: p.position,
            )
        ]
        risks = [
            p.text
            for p in sorted(
                (pt for pt in briefing.points if pt.kind == "risk"),
                key=lambda p: p.position,
            )
        ]
        metrics = [
            {"name": m.name, "value": m.value}
            for m in sorted(briefing.metrics, key=lambda m: m.name.lower())
        ] or None

        return BriefModel(
            ticker=briefing.ticker,
            companyName=briefing.companyName,
            analystName=briefing.analystName,
            sector=briefing.sector,
            summary=briefing.summary,
            recommendation=briefing.recommendation,
            keyPoints=key_points,
            risks=risks,
            metrics=metrics,
            generated=briefing.generated,
        )

    def render_base(self, briefing: Briefing) -> str:
        """Render the primary HTML report for a briefing."""
        template = self._env.get_template("base.html")
        view_model = self._build_view_model(briefing)
        return template.render(
            brief=view_model, generated_at=self.generated_timestamp()
        )

    @staticmethod
    def generated_timestamp() -> str:
        """Return an ISO-8601 timestamp for when the report was generated."""
        return datetime.now(timezone.utc).isoformat()

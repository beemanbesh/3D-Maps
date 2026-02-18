"""
PDF report generation endpoint.
"""

import io
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.models import Project, Building, Document

router = APIRouter()


class ProjectReport(FPDF):
    """Custom FPDF subclass with header/footer."""

    project_name: str = ""

    def header(self):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, f"Project Report: {self.project_name}", align="R")
        self.ln(12)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")


@router.get("/projects/{project_id}/report")
async def generate_project_report(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Generate a PDF summary report for a project."""
    result = await db.execute(
        select(Project)
        .where(Project.id == project_id)
        .options(selectinload(Project.buildings), selectinload(Project.documents))
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    pdf = ProjectReport()
    pdf.project_name = project.name
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # ---- Title Section ----
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 14, project.name, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 6, f"Generated: {datetime.now().strftime('%B %d, %Y at %H:%M')}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Status: {project.status.capitalize()}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    if project.description:
        pdf.set_font("Helvetica", "", 11)
        pdf.set_text_color(60, 60, 60)
        pdf.multi_cell(0, 6, project.description)
        pdf.ln(6)

    # ---- Divider ----
    pdf.set_draw_color(200, 200, 200)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    pdf.ln(8)

    # ---- Project Summary ----
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 10, "Project Summary", new_x="LMARGIN", new_y="NEXT")

    buildings = project.buildings or []
    documents = project.documents or []

    summary_data = [
        ("Total Buildings", str(len(buildings))),
        ("Documents Uploaded", str(len(documents))),
        ("Documents Processed", str(sum(1 for d in documents if d.processing_status == "completed"))),
    ]

    total_area = sum(
        (b.specifications or {}).get("total_area_sqm", 0) or 0
        for b in buildings
    )
    if total_area > 0:
        summary_data.append(("Total Area", f"{total_area:,.0f} m\u00b2"))

    total_units = sum(
        (b.specifications or {}).get("residential_units", 0) or 0
        for b in buildings
    )
    if total_units > 0:
        summary_data.append(("Residential Units", str(total_units)))

    if project.construction_phases:
        summary_data.append(("Construction Phases", str(len(project.construction_phases))))

    pdf.set_font("Helvetica", "", 10)
    for label, value in summary_data:
        pdf.set_text_color(100, 100, 100)
        pdf.cell(70, 7, label)
        pdf.set_text_color(30, 30, 30)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 7, value, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)

    pdf.ln(6)

    # ---- Buildings Detail ----
    if buildings:
        pdf.set_draw_color(200, 200, 200)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(8)

        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(0, 10, "Buildings", new_x="LMARGIN", new_y="NEXT")

        # Table header
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(240, 240, 240)
        pdf.set_text_color(60, 60, 60)
        col_widths = [50, 25, 25, 25, 30, 35]
        headers = ["Name", "Height (m)", "Floors", "Roof", "Phase", "Area (m\u00b2)"]
        for w, h in zip(col_widths, headers):
            pdf.cell(w, 7, h, border=1, fill=True)
        pdf.ln()

        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(30, 30, 30)
        for b in buildings:
            name = (b.name or "Unnamed")[:20]
            height = f"{float(b.height_meters):.1f}" if b.height_meters else "-"
            floors = str(b.floor_count) if b.floor_count else "-"
            roof = (b.roof_type or "-").capitalize()
            phase = str(b.construction_phase) if b.construction_phase else "-"
            area = f"{(b.specifications or {}).get('total_area_sqm', '-')}"

            row = [name, height, floors, roof, phase, area]
            for w, val in zip(col_widths, row):
                pdf.cell(w, 6, str(val), border=1)
            pdf.ln()

    # ---- Documents Section ----
    if documents:
        pdf.ln(6)
        pdf.set_draw_color(200, 200, 200)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(8)

        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(0, 10, "Documents", new_x="LMARGIN", new_y="NEXT")

        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(240, 240, 240)
        pdf.set_text_color(60, 60, 60)
        doc_cols = [80, 25, 30, 55]
        doc_headers = ["Filename", "Type", "Status", "Uploaded"]
        for w, h in zip(doc_cols, doc_headers):
            pdf.cell(w, 7, h, border=1, fill=True)
        pdf.ln()

        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(30, 30, 30)
        for d in documents:
            filename = d.filename[:35]
            ftype = d.file_type.upper()
            status = d.processing_status.capitalize()
            uploaded = d.uploaded_at.strftime("%Y-%m-%d %H:%M") if d.uploaded_at else "-"

            row = [filename, ftype, status, uploaded]
            for w, val in zip(doc_cols, row):
                pdf.cell(w, 6, val, border=1)
            pdf.ln()

    # ---- Construction Phases ----
    if project.construction_phases:
        pdf.ln(6)
        pdf.set_draw_color(200, 200, 200)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(8)

        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(0, 10, "Construction Phases", new_x="LMARGIN", new_y="NEXT")

        pdf.set_font("Helvetica", "", 10)
        for phase in sorted(project.construction_phases, key=lambda p: p.get("phase_number", 0)):
            pdf.set_text_color(30, 30, 30)
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(0, 7, f"Phase {phase.get('phase_number')}: {phase.get('name', 'Unnamed')}", new_x="LMARGIN", new_y="NEXT")
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(100, 100, 100)
            dates = []
            if phase.get("start_date"):
                dates.append(f"Start: {phase['start_date']}")
            if phase.get("end_date"):
                dates.append(f"End: {phase['end_date']}")
            if dates:
                pdf.cell(0, 6, "  ".join(dates), new_x="LMARGIN", new_y="NEXT")

    # Output PDF
    pdf_bytes = pdf.output()

    return Response(
        content=bytes(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{project.name} Report.pdf"',
        },
    )

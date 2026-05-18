import PDFDocument from 'pdfkit';

/**
 * Build a professional university-style schedule PDF and stream it to res.
 *
 * @param {import('express').Response} res
 * @param {{
 *   fileName: string,
 *   title: string,
 *   subtitle?: string,
 *   semester?: string | null,
 *   examPeriod?: string | null,
 *   scopeLabel?: string | null,
 *   audienceLine?: string | null,
 *   summary?: Array<{ label: string, value: string | number }>,
 *   columns: Array<{ key: string, label: string, width: number, align?: 'left'|'right'|'center' }>,
 *   rows: Array<Record<string, string | number | null | undefined>>,
 * }} payload
 */
export const streamScheduleReport = (res, payload) => {
  const {
    fileName,
    title,
    subtitle,
    semester,
    examPeriod,
    scopeLabel,
    audienceLine,
    summary = [],
    columns,
    rows,
  } = payload;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    bufferPages: true,
    margins: { top: 56, bottom: 56, left: 48, right: 48 },
    info: { Title: title, Author: 'Smart Exam Scheduling System' },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  doc.pipe(res);

  const PRIMARY = '#0f172a';
  const MUTED = '#64748b';
  const ACCENT = '#1e293b';
  const BORDER = '#e2e8f0';
  const ZEBRA = '#f8fafc';
  const HEADER_BG = '#0f172a';
  const PANEL_BG = '#f8fafc';
  const PANEL_BORDER = '#cbd5e1';
  const SUBTLE_TEXT = '#94a3b8';
  const SEMESTER_BADGE_BG = '#e0f2fe';
  const SEMESTER_BADGE_TEXT = '#0f3b66';
  const TABLE_HEADER_BG = '#111827';

  const pageWidth = doc.page.width;
  const contentLeft = doc.page.margins.left;
  const contentRight = pageWidth - doc.page.margins.right;
  const contentWidth = contentRight - contentLeft;

  const generatedAt = new Date();
  const generatedLabel = generatedAt.toLocaleString('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const formatSemesterLabel = (value) => {
    if (!value) return '';
    return String(value)
      .replace(/([A-Za-z])(\d{4})\b/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const visibleSemester = formatSemesterLabel(semester);
  const metaItems = [
    visibleSemester ? ['Semester', visibleSemester] : null,
    examPeriod ? ['Exam Period', examPeriod] : null,
    scopeLabel ? ['Scope', scopeLabel] : null,
    ['Generated', generatedLabel],
  ].filter(Boolean);

  // ---------- Header ----------
  const headerTop = doc.y;
  const bannerHeight = 84;
  doc.save();
  doc.rect(contentLeft, headerTop, contentWidth, bannerHeight).fill(HEADER_BG);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
    .text('Smart Exam Scheduling System', contentLeft + 18, headerTop + 16, { width: contentWidth - 36 });
  doc.font('Helvetica').fontSize(10).fillColor('#cbd5f5')
    .text('Official University Exam Schedule Report', contentLeft + 18, headerTop + 40, { width: contentWidth - 36 });
  doc.font('Helvetica').fontSize(9).fillColor('#93c5fd')
    .text('Published examination timetable', contentLeft + 18, headerTop + 56, { width: contentWidth - 36 });
  doc.restore();
  doc.y = headerTop + bannerHeight + 20;

  // ---------- Title / meta block ----------
  doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(20).text(title, contentLeft, doc.y, { width: contentWidth });
  if (subtitle) {
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(subtitle, { width: contentWidth });
  }

  if (visibleSemester) {
    doc.moveDown(0.45);
    const badgeTop = doc.y;
    const badgeHeight = 26;
    const badgeWidth = Math.min(220, Math.max(140, doc.widthOfString(visibleSemester, { font: 'Helvetica-Bold', size: 10 }) + 28));
    doc.save();
    doc.roundedRect(contentLeft, badgeTop, badgeWidth, badgeHeight, 4).fill(SEMESTER_BADGE_BG);
    doc.fillColor(SEMESTER_BADGE_TEXT).font('Helvetica-Bold').fontSize(10)
      .text(visibleSemester, contentLeft + 12, badgeTop + 7, { width: badgeWidth - 24, align: 'center' });
    doc.restore();
    doc.y = badgeTop + badgeHeight;
  }

  if (metaItems.length > 0) {
    doc.moveDown(0.65);
    const metaTop = doc.y;
    const metaGap = 10;
    const metaHeight = 42;
    const metaColWidth = (contentWidth - metaGap * (metaItems.length - 1)) / metaItems.length;
    metaItems.forEach(([label, value], i) => {
      const x = contentLeft + i * (metaColWidth + metaGap);
      doc.save();
      doc.roundedRect(x, metaTop, metaColWidth, metaHeight, 3).fillAndStroke(PANEL_BG, PANEL_BORDER);
      doc.fillColor(SUBTLE_TEXT).font('Helvetica-Bold').fontSize(7)
        .text(label.toUpperCase(), x + 10, metaTop + 8, { width: metaColWidth - 20, characterSpacing: 1.2 });
      doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(10)
        .text(String(value), x + 10, metaTop + 20, { width: metaColWidth - 20 });
      doc.restore();
    });
    doc.y = metaTop + metaHeight + 10;
  }

  if (audienceLine) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(ACCENT)
      .text(audienceLine, contentLeft, doc.y, { width: contentWidth });
    doc.moveDown(0.5);
  }

  // ---------- Summary chips ----------
  if (summary.length > 0) {
    const chipHeight = 46;
    const gap = 10;
    const safeSummaryCount = Math.max(summary.length, 1);
    const chipWidth = (contentWidth - gap * (safeSummaryCount - 1)) / safeSummaryCount;
    const chipTop = doc.y + 4;
    summary.forEach((item, i) => {
      const x = contentLeft + i * (chipWidth + gap);
      doc.save();
      doc.roundedRect(x, chipTop, chipWidth, chipHeight, 3).fillAndStroke('#f8fafc', BORDER);
      doc.fillColor(SUBTLE_TEXT).font('Helvetica-Bold').fontSize(7)
        .text(String(item.label).toUpperCase(), x + 10, chipTop + 8, { width: chipWidth - 20, characterSpacing: 1 });
      doc.fillColor(PRIMARY).font('Helvetica-Bold').fontSize(16)
        .text(String(item.value ?? '—'), x + 10, chipTop + 20, { width: chipWidth - 20 });
      doc.restore();
    });
    doc.y = chipTop + chipHeight + 14;
  }

  // ---------- Table ----------
  const totalColWeight = columns.reduce((sum, c) => sum + c.width, 0);
  const colWidths = columns.map((c) => (c.width / totalColWeight) * contentWidth);

  const tableHeaderHeight = 30;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 24;

  const drawHeader = () => {
    const top = doc.y;
    doc.save();
    doc.roundedRect(contentLeft, top, contentWidth, tableHeaderHeight, 2).fill(TABLE_HEADER_BG);
    let x = contentLeft;
    columns.forEach((col, i) => {
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9)
        .text(col.label.toUpperCase(), x + 8, top + 10, {
          width: colWidths[i] - 16,
          align: col.align ?? 'left',
          characterSpacing: 0.8,
        });
      x += colWidths[i];
    });
    doc.restore();
    doc.y = top + tableHeaderHeight;
  };

  const measureRowHeight = (row) => {
    let max = 24;
    columns.forEach((col, i) => {
      const text = row[col.key] == null || row[col.key] === '' ? '—' : String(row[col.key]);
      const h = doc.font('Helvetica').fontSize(9).heightOfString(text, {
        width: colWidths[i] - 16,
        align: col.align ?? 'left',
      });
      if (h + 16 > max) max = h + 16;
    });
    return max;
  };

  const drawRow = (row, index) => {
    const rowHeight = measureRowHeight(row);
    if (doc.y + rowHeight > bottomLimit()) {
      doc.addPage();
      drawHeader();
    }
    const top = doc.y;
    if (index % 2 === 1) {
      doc.save();
      doc.rect(contentLeft, top, contentWidth, rowHeight).fill(ZEBRA);
      doc.restore();
    }
    let x = contentLeft;
    columns.forEach((col, i) => {
      const text = row[col.key] == null || row[col.key] === '' ? '—' : String(row[col.key]);
      doc.fillColor(PRIMARY).font('Helvetica').fontSize(9)
        .text(text, x + 8, top + 8, {
          width: colWidths[i] - 16,
          align: col.align ?? 'left',
        });
      x += colWidths[i];
    });
    // bottom border
    doc.save();
    doc.strokeColor(BORDER).lineWidth(0.5)
      .moveTo(contentLeft, top + rowHeight).lineTo(contentRight, top + rowHeight).stroke();
    doc.restore();
    doc.y = top + rowHeight;
  };

  if (rows.length === 0) {
    drawHeader();
    const top = doc.y;
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(10)
      .text('No exams to display for this scope.', contentLeft, top + 16, {
        width: contentWidth,
        align: 'center',
      });
    doc.y = top + 40;
  } else {
    drawHeader();
    rows.forEach((row, i) => drawRow(row, i));
  }

  // ---------- Page numbers footer ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const footerY = doc.page.height - doc.page.margins.bottom + 12;
    doc.save();
    doc.strokeColor(BORDER).lineWidth(0.75)
      .moveTo(doc.page.margins.left, footerY - 6)
      .lineTo(contentRight, footerY - 6)
      .stroke();
    doc.restore();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(
        `Smart Exam Scheduling System  •  Generated ${generatedLabel}`,
        doc.page.margins.left,
        footerY,
        { width: contentWidth, align: 'left' }
      );
    doc.text(
      `Page ${i + 1} of ${range.count}`,
      doc.page.margins.left,
      footerY,
      { width: contentWidth, align: 'right' }
    );
  }

  doc.end();
};

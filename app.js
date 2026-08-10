"use strict";

/* ==========================================================
   GST FUEL and STATEMENT File Extractor - Version 5

   Keeps the original reliable PDF date-renaming logic and adds:
   - Folder or ZIP input
   - Drag-and-drop folder/ZIP input
   - Automatic PDF pay-period detection
   - Automatic expected-month detection
   - Missing/incomplete pay-period detection
   - Rename preview before output ZIP creation
   - Built-in How to Use help dialog
   ========================================================== */

const PDFJS_VERSION = "3.11.174";
const PDFJS_WORKER =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
}

const elements = {
  dropZone: document.getElementById("dropZone"),
  folderInput: document.getElementById("folderInput"),
  zipInput: document.getElementById("zipInput"),
  monthsInput: document.getElementById("monthsInput"),
  monthsHelper: document.getElementById("monthsHelper"),
  structuredOption: document.getElementById("structuredOption"),
  flatOption: document.getElementById("flatOption"),
  renameOption: document.getElementById("renameOption"),
  auditOption: document.getElementById("auditOption"),
  processButton: document.getElementById("processButton"),
  resetButton: document.getElementById("resetButton"),
  downloadButton: document.getElementById("downloadButton"),
  selectionSummary: document.getElementById("selectionSummary"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),

  detectedMonthsCount: document.getElementById("detectedMonthsCount"),
  detectedPeriodCount: document.getElementById("detectedPeriodCount"),
  missingPeriodCount: document.getElementById("missingPeriodCount"),
  previewErrorCount: document.getElementById("previewErrorCount"),
  periodStatus: document.getElementById("periodStatus"),
  periodResultsBody: document.getElementById("periodResultsBody"),
  previewStatus: document.getElementById("previewStatus"),
  renamePreviewBody: document.getElementById("renamePreviewBody"),

  folderCount: document.getElementById("folderCount"),
  pdfCount: document.getElementById("pdfCount"),
  issueCount: document.getElementById("issueCount"),
  errorCount: document.getElementById("errorCount"),
  overallStatus: document.getElementById("overallStatus"),
  folderResultsBody: document.getElementById("folderResultsBody"),
  processingLog: document.getElementById("processingLog"),
  pennerLogo: document.getElementById("pennerLogo"),
  logoFallback: document.getElementById("logoFallback"),

  helpButton: document.getElementById("helpButton"),
  helpModal: document.getElementById("helpModal"),
  helpCloseButton: document.getElementById("helpCloseButton"),
  helpDoneButton: document.getElementById("helpDoneButton")
};

const DEFAULT_MONTHS = elements.monthsInput?.defaultValue || "3";

let selectedEntries = [];
let selectedSource = null;
let generatedZipBlob = null;
let generatedZipName = "";

let previewRows = [];
let previewByEntryKey = new Map();
let previewReady = false;
let periodSummary = createEmptyPeriodSummary();

let isLoadingSource = false;
let isPreviewing = false;
let isProcessing = false;
let previewRunId = 0;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/* ==========================================================
   Interface helpers
   ========================================================== */

function log(message) {
  const timestamp = new Date().toLocaleTimeString([], { hour12: false });
  const current =
    elements.processingLog.textContent === "Ready."
      ? ""
      : elements.processingLog.textContent;

  elements.processingLog.textContent =
    `${current}[${timestamp}] ${message}\n`;
  elements.processingLog.scrollTop = elements.processingLog.scrollHeight;
}

function setProgress(current, total, message) {
  const percent = total > 0
    ? Math.round((current / total) * 100)
    : 0;

  elements.progressBar.value = percent;
  elements.progressText.textContent = message || `${percent}%`;
}

function setOverallStatus(kind, message) {
  elements.overallStatus.className = `status-callout ${kind}`;
  elements.overallStatus.textContent = message;
}

function setPeriodStatus(kind, message) {
  elements.periodStatus.className = `status-callout ${kind}`;
  elements.periodStatus.textContent = message;
}

function setPreviewStatus(kind, message) {
  elements.previewStatus.className = `status-callout ${kind}`;
  elements.previewStatus.textContent = message;
}

function clearGeneratedOutput() {
  generatedZipBlob = null;
  generatedZipName = "";
  elements.downloadButton.disabled = true;
}

function updateControlState() {
  const sourceLocked = isLoadingSource || isProcessing;

  elements.folderInput.disabled = sourceLocked;
  elements.zipInput.disabled = sourceLocked;
  elements.monthsInput.disabled = isProcessing;
  elements.structuredOption.disabled = isProcessing;
  elements.flatOption.disabled = isProcessing;
  elements.renameOption.disabled = isProcessing;
  elements.auditOption.disabled = isProcessing;
  elements.resetButton.disabled = isProcessing;

  elements.dropZone.classList.toggle("is-busy", sourceLocked);

  const baseAnalysis = analyzeEntries(selectedEntries);
  elements.processButton.disabled =
    sourceLocked
    || isPreviewing
    || !previewReady
    || baseAnalysis.matchingEntries.length === 0;
}

function setEmptyTable(tbody, colSpan, message) {
  tbody.replaceChildren();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = colSpan;
  cell.className = "empty-state";
  cell.textContent = message;
  row.appendChild(cell);
  tbody.appendChild(row);
}

/* ==========================================================
   File and path detection
   ========================================================== */

function normalizePath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function entryKey(entry) {
  return normalizePath(entry.relativePath).toLowerCase();
}

function isValidDateFolderName(folderName) {
  if (!/^\d{8}$/.test(folderName)) return false;

  const year = Number(folderName.slice(0, 4));
  const month = Number(folderName.slice(4, 6));
  const day = Number(folderName.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function getDatedFolder(relativePath) {
  const parts = normalizePath(relativePath).split("/").filter(Boolean);

  // Matching PDFs must be directly inside an 8-digit dated folder.
  // Extra outer folders are allowed.
  if (parts.length < 2) {
    return null;
  }

  const immediateParent = parts[parts.length - 2];
  return isValidDateFolderName(immediateParent)
    ? immediateParent
    : null;
}

function getDocumentType(fileName) {
  const baseName = fileName.replace(/\.pdf$/i, "");
  const match = baseName.match(/_(FUEL|STATEMENT)$/i);
  return match ? match[1].toUpperCase() : null;
}

/* ==========================================================
   Original reliable PDF date and unit extraction logic
   ========================================================== */

function parseDocumentDate(dateText) {
  const match = String(dateText)
    .trim()
    .match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function compareDocumentDates(a, b) {
  return (a.year - b.year)
    || (a.month - b.month)
    || (a.day - b.day);
}

function dateKey(date) {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function normalizePdfText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdfText(bytes) {
  if (!window.pdfjsLib) {
    throw new Error(
      "PDF.js did not load. Check your internet connection and reload the page."
    );
  }

  const loadingTask = window.pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pageTexts = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map(item => item.str).join(" "));
    }
  } finally {
    await pdf.destroy();
  }

  return normalizePdfText(pageTexts.join(" "));
}

function getDocumentPeriod(text, documentType) {
  if (documentType === "FUEL") {
    const fuelMatch = text.match(
      /For\s+the\s+Period\s+from\s+(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s+to\s+(\d{4}[/-]\d{1,2}[/-]\d{1,2})/i
    );

    if (fuelMatch) {
      const startDate = parseDocumentDate(fuelMatch[1]);
      const endDate = parseDocumentDate(fuelMatch[2]);

      if (startDate && endDate) {
        return {
          startDate,
          endDate,
          method: "Fuel period text"
        };
      }
    }
  }

  if (documentType === "STATEMENT") {
    const startPatterns = [
      /Period\s*Start\s*[:\-]?\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2})/i,
      /(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*Period\s*Start/i
    ];

    const endPatterns = [
      /Period\s*End\s*[:\-]?\s*(\d{4}[/-]\d{1,2}[/-]\d{1,2})/i,
      /(\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*Period\s*End/i
    ];

    let startDate = null;
    let endDate = null;

    for (const pattern of startPatterns) {
      const match = text.match(pattern);
      if (match) {
        startDate = parseDocumentDate(match[1]);
        if (startDate) break;
      }
    }

    for (const pattern of endPatterns) {
      const match = text.match(pattern);
      if (match) {
        endDate = parseDocumentDate(match[1]);
        if (endDate) break;
      }
    }

    if (startDate && endDate) {
      return {
        startDate,
        endDate,
        method: "Statement period labels"
      };
    }

    const uniqueDates = [
      ...text.matchAll(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g)
    ]
      .map(match => parseDocumentDate(match[0]))
      .filter(Boolean)
      .sort(compareDocumentDates)
      .filter(
        (date, index, array) =>
          index === 0
          || dateKey(date) !== dateKey(array[index - 1])
      );

    if (uniqueDates.length >= 2) {
      return {
        startDate: uniqueDates[0],
        endDate: uniqueDates[1],
        method: "Two earliest statement dates"
      };
    }
  }

  return null;
}

function getUnitNumber(fileName, text) {
  // Keep the original successful logic: numeric unit from the filename first.
  const fileMatch = fileName.match(/^\d{8}_(\d+)_/);
  if (fileMatch) return fileMatch[1];

  const textMatch = text.match(/UNIT\s*#?\s*:\s*(\d+)/i);
  return textMatch ? textMatch[1] : "UNKNOWN";
}

function buildRenamedFileName(period, unitNumber, documentType) {
  const end = period.endDate;
  const yearMonth =
    `${String(end.year).padStart(4, "0")}-${String(end.month).padStart(2, "0")}`;
  const monthName = MONTH_NAMES[end.month - 1];
  const periodRange =
    `${String(period.startDate.day).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`;

  return `${yearMonth}_${monthName}_${periodRange}_${unitNumber}_${documentType}.pdf`;
}

/* ==========================================================
   Pay-period helpers
   ========================================================== */

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthIndex(date) {
  return (date.year * 12) + (date.month - 1);
}

function monthFromIndex(index) {
  return {
    year: Math.floor(index / 12),
    month: (index % 12) + 1
  };
}

function periodKey(period) {
  return `${dateKey(period.startDate)}|${dateKey(period.endDate)}`;
}

function formatPeriodLabel(period) {
  const start = period.startDate;
  const end = period.endDate;

  if (start.year === end.year && start.month === end.month) {
    return `${MONTH_NAMES_SHORT[end.month - 1]} ${String(start.day).padStart(2, "0")}–${String(end.day).padStart(2, "0")}, ${end.year}`;
  }

  return `${dateKey(start)} to ${dateKey(end)}`;
}

function formatMonthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function standardPeriodsForMonth(year, month) {
  const lastDay = daysInMonth(year, month);

  return [
    {
      startDate: { year, month, day: 1 },
      endDate: { year, month, day: 15 }
    },
    {
      startDate: { year, month, day: 16 },
      endDate: { year, month, day: lastDay }
    }
  ];
}

function createEmptyPeriodSummary() {
  return {
    detectedMonths: 0,
    detectedPeriodCount: 0,
    expectedPeriodCount: 0,
    missingPeriodCount: 0,
    incompletePeriodCount: 0,
    duplicatePeriodCount: 0,
    nonStandardPeriodCount: 0,
    previewErrorCount: 0,
    rangeLabel: "",
    rows: []
  };
}

function buildPeriodSummary(rows) {
  const summary = createEmptyPeriodSummary();
  summary.previewErrorCount = rows.filter(row => row.status === "Error").length;

  const successfulRows = rows.filter(
    row => row.status === "Ready" && row.period
  );

  if (!successfulRows.length) {
    return summary;
  }

  const actualPeriodMap = new Map();

  for (const row of successfulRows) {
    const key = periodKey(row.period);

    if (!actualPeriodMap.has(key)) {
      actualPeriodMap.set(key, {
        period: row.period,
        FUEL: [],
        STATEMENT: [],
        folders: new Set()
      });
    }

    const record = actualPeriodMap.get(key);
    record[row.documentType].push(row);
    record.folders.add(row.sourceFolder);
  }

  summary.detectedPeriodCount = actualPeriodMap.size;

  const endMonthIndexes = successfulRows.map(row => monthIndex(row.period.endDate));
  const firstMonthIndex = Math.min(...endMonthIndexes);
  const lastMonthIndex = Math.max(...endMonthIndexes);
  summary.detectedMonths = (lastMonthIndex - firstMonthIndex) + 1;

  const firstMonth = monthFromIndex(firstMonthIndex);
  const lastMonth = monthFromIndex(lastMonthIndex);

  summary.rangeLabel = firstMonthIndex === lastMonthIndex
    ? formatMonthLabel(firstMonth.year, firstMonth.month)
    : `${formatMonthLabel(firstMonth.year, firstMonth.month)} – ${formatMonthLabel(lastMonth.year, lastMonth.month)}`;

  const expectedKeys = new Set();
  const periodRows = [];

  for (let index = firstMonthIndex; index <= lastMonthIndex; index += 1) {
    const { year, month } = monthFromIndex(index);

    for (const expectedPeriod of standardPeriodsForMonth(year, month)) {
      const key = periodKey(expectedPeriod);
      expectedKeys.add(key);

      const actual = actualPeriodMap.get(key) || {
        period: expectedPeriod,
        FUEL: [],
        STATEMENT: [],
        folders: new Set()
      };

      const fuelCount = actual.FUEL.length;
      const statementCount = actual.STATEMENT.length;

      let status = "Complete";
      let statusKind = "success";

      if (fuelCount === 0 && statementCount === 0) {
        status = "Missing period";
        statusKind = "warning";
        summary.missingPeriodCount += 1;
      } else if (fuelCount === 0) {
        status = "Missing FUEL";
        statusKind = "warning";
        summary.incompletePeriodCount += 1;
      } else if (statementCount === 0) {
        status = "Missing STATEMENT";
        statusKind = "warning";
        summary.incompletePeriodCount += 1;
      } else if (fuelCount > 1 || statementCount > 1) {
        status = "Duplicate files";
        statusKind = "warning";
        summary.duplicatePeriodCount += 1;
      }

      periodRows.push({
        period: expectedPeriod,
        fuelCount,
        statementCount,
        folders: [...actual.folders].sort(),
        status,
        statusKind,
        isExpected: true
      });
    }
  }

  summary.expectedPeriodCount = periodRows.length;

  for (const [key, actual] of actualPeriodMap.entries()) {
    if (expectedKeys.has(key)) continue;

    summary.nonStandardPeriodCount += 1;
    periodRows.push({
      period: actual.period,
      fuelCount: actual.FUEL.length,
      statementCount: actual.STATEMENT.length,
      folders: [...actual.folders].sort(),
      status: "Non-standard period",
      statusKind: "warning",
      isExpected: false
    });
  }

  periodRows.sort((a, b) => {
    const startCompare = compareDocumentDates(a.period.startDate, b.period.startDate);
    if (startCompare !== 0) return startCompare;
    return compareDocumentDates(a.period.endDate, b.period.endDate);
  });

  summary.rows = periodRows;
  return summary;
}

function renderPeriodSummary(summary) {
  elements.detectedMonthsCount.textContent = String(summary.detectedMonths);
  elements.detectedPeriodCount.textContent = String(summary.detectedPeriodCount);
  elements.missingPeriodCount.textContent = String(summary.missingPeriodCount);
  elements.previewErrorCount.textContent = String(summary.previewErrorCount);

  if (!summary.rows.length) {
    setEmptyTable(elements.periodResultsBody, 5, "No periods detected yet.");

    if (isPreviewing) {
      setPeriodStatus("neutral", "Reading pay-period dates from the PDFs...");
    } else if (summary.previewErrorCount > 0) {
      setPeriodStatus(
        "warning",
        "No pay periods could be detected from the selected PDFs. Review the rename preview errors."
      );
    } else {
      setPeriodStatus(
        "neutral",
        "Pay periods will be detected automatically after you select files."
      );
    }
    return;
  }

  elements.periodResultsBody.replaceChildren();

  for (const rowData of summary.rows) {
    const row = document.createElement("tr");

    const periodCell = document.createElement("td");
    const periodChip = document.createElement("span");
    periodChip.className = "period-chip";
    periodChip.textContent = formatPeriodLabel(rowData.period);
    periodCell.appendChild(periodChip);
    row.appendChild(periodCell);

    const fuelCell = document.createElement("td");
    fuelCell.textContent = rowData.fuelCount === 0
      ? "Missing"
      : `Found (${rowData.fuelCount})`;
    row.appendChild(fuelCell);

    const statementCell = document.createElement("td");
    statementCell.textContent = rowData.statementCount === 0
      ? "Missing"
      : `Found (${rowData.statementCount})`;
    row.appendChild(statementCell);

    const folderCell = document.createElement("td");
    folderCell.textContent = rowData.folders.length
      ? rowData.folders.join(", ")
      : "—";
    row.appendChild(folderCell);

    const statusCell = document.createElement("td");
    statusCell.className = `status-text ${rowData.statusKind}`;
    statusCell.textContent = rowData.status;
    row.appendChild(statusCell);

    elements.periodResultsBody.appendChild(row);
  }

  const issues = [];

  if (summary.missingPeriodCount > 0) {
    issues.push(`${summary.missingPeriodCount} completely missing pay period(s)`);
  }

  if (summary.incompletePeriodCount > 0) {
    issues.push(`${summary.incompletePeriodCount} incomplete pay period(s)`);
  }

  if (summary.duplicatePeriodCount > 0) {
    issues.push(`${summary.duplicatePeriodCount} pay period(s) with duplicate files`);
  }

  if (summary.nonStandardPeriodCount > 0) {
    issues.push(`${summary.nonStandardPeriodCount} non-standard pay period(s)`);
  }

  if (summary.previewErrorCount > 0) {
    issues.push(`${summary.previewErrorCount} PDF analysis error(s)`);
  }

  if (!issues.length) {
    setPeriodStatus(
      "success",
      `Detected ${summary.rangeLabel}: ${summary.detectedMonths} month(s) and ${summary.expectedPeriodCount} expected pay periods. All expected periods have both FUEL and STATEMENT files.`
    );
  } else {
    setPeriodStatus(
      "warning",
      `Detected ${summary.rangeLabel}. Review needed: ${issues.join("; ")}.`
    );
  }
}

/* ==========================================================
   Base file validation
   ========================================================== */

function analyzeEntries(entries) {
  const folderMap = new Map();
  const matchingEntries = [];
  const matchingOutsideDatedFolders = [];

  for (const entry of entries) {
    const documentType = getDocumentType(entry.name);
    if (!documentType) continue;

    const sourceFolder = getDatedFolder(entry.relativePath);

    if (!sourceFolder) {
      matchingOutsideDatedFolders.push({
        ...entry,
        documentType
      });
      continue;
    }

    const preparedEntry = {
      ...entry,
      sourceFolder,
      documentType
    };

    matchingEntries.push(preparedEntry);

    if (!folderMap.has(sourceFolder)) {
      folderMap.set(sourceFolder, {
        FUEL: 0,
        STATEMENT: 0,
        total: 0
      });
    }

    const counts = folderMap.get(sourceFolder);
    counts[documentType] += 1;
    counts.total += 1;
  }

  return {
    folderMap,
    matchingEntries,
    matchingOutsideDatedFolders
  };
}

function renderFolderValidation(folderMap) {
  const entries = [...folderMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b));

  elements.folderResultsBody.replaceChildren();

  if (!entries.length) {
    setEmptyTable(elements.folderResultsBody, 5, "No dated folders found.");
    return 0;
  }

  let issueCount = 0;

  for (const [folderName, counts] of entries) {
    const passed = counts.FUEL === 1 && counts.STATEMENT === 1;
    if (!passed) issueCount += 1;

    const row = document.createElement("tr");

    for (const value of [
      folderName,
      String(counts.FUEL),
      String(counts.STATEMENT),
      String(counts.total)
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    const statusCell = document.createElement("td");
    statusCell.className =
      `status-text ${passed ? "success" : "warning"}`;
    statusCell.textContent = passed ? "Passed" : "Check files";
    row.appendChild(statusCell);

    elements.folderResultsBody.appendChild(row);
  }

  return issueCount;
}

function refreshValidation() {
  clearGeneratedOutput();

  const analysis = analyzeEntries(selectedEntries);
  const folderIssueCount = renderFolderValidation(analysis.folderMap);
  const datedFolderCount = analysis.folderMap.size;
  const matchingCount = analysis.matchingEntries.length;

  elements.folderCount.textContent = String(datedFolderCount);
  elements.pdfCount.textContent = String(matchingCount);
  elements.issueCount.textContent = String(folderIssueCount);

  if (!isProcessing) {
    elements.errorCount.textContent = String(periodSummary.previewErrorCount || 0);
  }

  if (!selectedSource) {
    elements.selectionSummary.textContent = "No folder or ZIP file selected.";
    setOverallStatus("neutral", "Select a folder or ZIP file to begin.");
    updateControlState();
    return;
  }

  const sourceLabel = selectedSource.type === "zip"
    ? "ZIP"
    : selectedSource.type === "drop"
      ? "Dropped folder"
      : "Folder";

  elements.selectionSummary.textContent =
    `${sourceLabel}: ${selectedSource.name} — `
    + `${selectedSource.totalFiles} total files, `
    + `${matchingCount} matching PDFs, `
    + `${datedFolderCount} dated folders.`;

  if (matchingCount === 0) {
    setOverallStatus(
      "warning",
      "No PDFs ending exactly in _FUEL.pdf or _STATEMENT.pdf were found directly inside valid 8-digit dated folders."
    );
    updateControlState();
    return;
  }

  if (isPreviewing) {
    setOverallStatus(
      "neutral",
      `Found ${matchingCount} matching PDFs. Reading pay-period dates and preparing the rename preview...`
    );
    updateControlState();
    return;
  }

  const expectedMonths = Number(elements.monthsInput.value);
  const expectedFolderCount = Number.isInteger(expectedMonths)
    ? expectedMonths * 2
    : 0;
  const expectedPdfCount = Number.isInteger(expectedMonths)
    ? expectedMonths * 4
    : 0;

  const messages = [];

  if (datedFolderCount !== expectedFolderCount) {
    messages.push(
      `found ${datedFolderCount} dated folders; expected ${expectedFolderCount}`
    );
  }

  if (matchingCount !== expectedPdfCount) {
    messages.push(
      `found ${matchingCount} matching PDFs; expected ${expectedPdfCount}`
    );
  }

  if (folderIssueCount > 0) {
    messages.push(
      `${folderIssueCount} folder(s) do not have exactly 1 FUEL and 1 STATEMENT`
    );
  }

  if (analysis.matchingOutsideDatedFolders.length > 0) {
    messages.push(
      `${analysis.matchingOutsideDatedFolders.length} matching PDF(s) were outside a valid dated folder`
    );
  }

  if (previewReady) {
    if (periodSummary.missingPeriodCount > 0) {
      messages.push(`${periodSummary.missingPeriodCount} pay period(s) are completely missing`);
    }

    if (periodSummary.incompletePeriodCount > 0) {
      messages.push(`${periodSummary.incompletePeriodCount} pay period(s) are missing FUEL or STATEMENT`);
    }

    if (periodSummary.duplicatePeriodCount > 0) {
      messages.push(`${periodSummary.duplicatePeriodCount} pay period(s) contain duplicate document types`);
    }

    if (periodSummary.previewErrorCount > 0) {
      messages.push(`${periodSummary.previewErrorCount} PDF(s) could not be analyzed`);
    }
  }

  if (messages.length === 0) {
    setOverallStatus(
      "success",
      `Validation passed: found ${datedFolderCount} dated folders and ${matchingCount} matching PDFs with all expected pay periods present.`
    );
  } else {
    setOverallStatus("warning", `Review needed: ${messages.join("; ")}.`);
  }

  updateControlState();
}

/* ==========================================================
   Rename preview
   ========================================================== */

function resetPreviewState() {
  previewRows = [];
  previewByEntryKey = new Map();
  previewReady = false;
  periodSummary = createEmptyPeriodSummary();

  elements.detectedMonthsCount.textContent = "0";
  elements.detectedPeriodCount.textContent = "0";
  elements.missingPeriodCount.textContent = "0";
  elements.previewErrorCount.textContent = "0";

  setEmptyTable(elements.periodResultsBody, 5, "No periods detected yet.");
  setEmptyTable(elements.renamePreviewBody, 6, "No rename preview yet.");

  setPeriodStatus(
    "neutral",
    "Pay periods will be detected automatically after you select files."
  );

  setPreviewStatus(
    "neutral",
    "Select a folder or ZIP to preview the detected dates and filenames."
  );
}

function renderRenamePreview(rows) {
  if (!rows.length) {
    setEmptyTable(elements.renamePreviewBody, 6, "No matching PDFs were available for the rename preview.");
    return;
  }

  const sortedRows = [...rows].sort((a, b) => {
    if (a.period && b.period) {
      const dateCompare = compareDocumentDates(a.period.startDate, b.period.startDate);
      if (dateCompare !== 0) return dateCompare;
    } else if (a.period && !b.period) {
      return -1;
    } else if (!a.period && b.period) {
      return 1;
    }

    const folderCompare = a.sourceFolder.localeCompare(b.sourceFolder);
    if (folderCompare !== 0) return folderCompare;
    return a.originalFile.localeCompare(b.originalFile);
  });

  elements.renamePreviewBody.replaceChildren();

  for (const rowData of sortedRows) {
    const row = document.createElement("tr");

    const folderCell = document.createElement("td");
    folderCell.textContent = rowData.sourceFolder;
    row.appendChild(folderCell);

    const originalCell = document.createElement("td");
    originalCell.textContent = rowData.originalFile;
    row.appendChild(originalCell);

    const periodCell = document.createElement("td");
    periodCell.textContent = rowData.period
      ? formatPeriodLabel(rowData.period)
      : "Not detected";
    row.appendChild(periodCell);

    const unitCell = document.createElement("td");
    unitCell.textContent = rowData.unitNumber || "—";
    row.appendChild(unitCell);

    const proposedCell = document.createElement("td");
    proposedCell.textContent = rowData.proposedFileName || "—";
    row.appendChild(proposedCell);

    const statusCell = document.createElement("td");
    statusCell.className = `status-text ${rowData.status === "Ready" ? "success" : "error"}`;
    statusCell.textContent = rowData.status === "Ready"
      ? "Ready"
      : `Error: ${rowData.message}`;
    row.appendChild(statusCell);

    elements.renamePreviewBody.appendChild(row);
  }
}

async function analyzeSelectedSourceForPreview() {
  const analysis = analyzeEntries(selectedEntries);

  if (!selectedSource || !analysis.matchingEntries.length) {
    resetPreviewState();
    refreshValidation();
    return;
  }

  if (!window.pdfjsLib) {
    previewReady = false;
    setPreviewStatus(
      "error",
      "PDF.js did not load, so the pay periods and renamed filenames cannot be previewed."
    );
    setPeriodStatus(
      "error",
      "PDF.js did not load, so automatic pay-period detection is unavailable."
    );
    updateControlState();
    return;
  }

  const thisRunId = previewRunId;
  isPreviewing = true;
  clearGeneratedOutput();
  previewReady = false;
  previewRows = [];
  previewByEntryKey = new Map();
  periodSummary = createEmptyPeriodSummary();

  setPreviewStatus("neutral", "Reading PDF dates and preparing the rename preview...");
  setPeriodStatus("neutral", "Reading pay-period dates from the PDFs...");
  elements.processingLog.textContent = "Ready.";
  log(`Analyzing ${analysis.matchingEntries.length} matching PDFs for period dates and rename preview.`);
  refreshValidation();
  updateControlState();

  const rows = [];

  for (let index = 0; index < analysis.matchingEntries.length; index += 1) {
    if (thisRunId !== previewRunId) {
      return;
    }

    const entry = analysis.matchingEntries[index];

    setProgress(
      index,
      Math.max(analysis.matchingEntries.length, 1),
      `Analyzing ${index + 1} of ${analysis.matchingEntries.length}: ${entry.name}`
    );

    try {
      const sourceBuffer = await entry.getArrayBuffer();
      const sourceBytes = new Uint8Array(sourceBuffer);
      const text = await extractPdfText(sourceBytes.slice());
      const period = getDocumentPeriod(text, entry.documentType);

      if (!period) {
        throw new Error("Period start and end dates were not detected.");
      }

      if (compareDocumentDates(period.startDate, period.endDate) > 0) {
        throw new Error("Detected period start is after period end.");
      }

      const unitNumber = getUnitNumber(entry.name, text);
      const proposedFileName = buildRenamedFileName(
        period,
        unitNumber,
        entry.documentType
      );

      rows.push({
        entryKey: entryKey(entry),
        relativePath: entry.relativePath,
        sourceFolder: entry.sourceFolder,
        originalFile: entry.name,
        documentType: entry.documentType,
        period,
        unitNumber,
        detectionMethod: period.method,
        proposedFileName,
        status: "Ready",
        message: ""
      });

      log(
        `Preview ${entry.relativePath} -> ${proposedFileName} `
        + `(${dateKey(period.startDate)} to ${dateKey(period.endDate)})`
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : String(error);

      rows.push({
        entryKey: entryKey(entry),
        relativePath: entry.relativePath,
        sourceFolder: entry.sourceFolder,
        originalFile: entry.name,
        documentType: entry.documentType,
        period: null,
        unitNumber: "",
        detectionMethod: "",
        proposedFileName: "",
        status: "Error",
        message
      });

      log(`PREVIEW ERROR ${entry.relativePath}: ${message}`);
    }
  }

  if (thisRunId !== previewRunId) {
    return;
  }

  previewRows = rows;
  previewByEntryKey = new Map(
    rows.map(row => [row.entryKey, row])
  );
  previewReady = true;
  periodSummary = buildPeriodSummary(rows);

  if (periodSummary.detectedMonths > 0) {
    elements.monthsInput.value = String(periodSummary.detectedMonths);
    elements.monthsHelper.textContent =
      `Auto-detected ${periodSummary.detectedMonths} month(s) from PDF pay periods (${periodSummary.rangeLabel}). You can override this value.`;
  } else {
    elements.monthsHelper.textContent =
      "The month count could not be detected from the PDFs. Enter the expected number of months manually.";
  }

  renderRenamePreview(rows);
  renderPeriodSummary(periodSummary);

  const readyCount = rows.filter(row => row.status === "Ready").length;
  const errorCount = rows.length - readyCount;

  if (errorCount === 0) {
    setPreviewStatus(
      "success",
      `${readyCount} PDF(s) analyzed successfully. Review the proposed filenames below before creating the output ZIP.`
    );
  } else {
    setPreviewStatus(
      "warning",
      `${readyCount} PDF(s) are ready to rename and ${errorCount} PDF(s) could not be analyzed. Files with preview errors will not be renamed or added to the output while renaming is enabled.`
    );
  }

  isPreviewing = false;
  setProgress(1, 1, "Preview ready");
  refreshValidation();
  updateControlState();
}

/* ==========================================================
   Source selection: normal folder
   ========================================================== */

async function commitSelectedEntries(entries, source) {
  previewRunId += 1;
  clearGeneratedOutput();
  resetPreviewState();

  selectedEntries = entries;
  selectedSource = source;

  elements.processingLog.textContent = "Ready.";
  log(`Selected ${source.type}: ${source.name}`);
  refreshValidation();

  await analyzeSelectedSourceForPreview();
}

async function handleFolderSelection(event) {
  const files = Array.from(event.target.files || []);
  elements.zipInput.value = "";

  if (!files.length) {
    previewRunId += 1;
    selectedEntries = [];
    selectedSource = null;
    resetPreviewState();
    refreshValidation();
    return;
  }

  const entries = files.map(file => ({
    name: file.name,
    relativePath: normalizePath(file.webkitRelativePath || file.name),
    sourceType: "folder",
    getArrayBuffer: () => file.arrayBuffer()
  }));

  const firstPath = entries[0].relativePath;
  const rootFolder = firstPath.split("/")[0] || "Selected folder";

  await commitSelectedEntries(entries, {
    type: "folder",
    name: rootFolder,
    totalFiles: entries.length
  });
}

/* ==========================================================
   Source selection: ZIP file
   ========================================================== */

async function loadZipFile(zipFile, sourceType = "zip") {
  if (!zipFile) return;

  if (!window.JSZip) {
    setOverallStatus(
      "error",
      "JSZip did not load. Check your internet connection and reload the page."
    );
    return;
  }

  previewRunId += 1;
  isLoadingSource = true;
  updateControlState();
  clearGeneratedOutput();
  resetPreviewState();
  elements.processingLog.textContent = "Ready.";
  setProgress(0, 1, "Reading ZIP file...");
  log(`Opening ZIP file: ${zipFile.name}`);

  try {
    const inputZip = await window.JSZip.loadAsync(zipFile);
    const entries = [];

    for (const [path, zipEntry] of Object.entries(inputZip.files)) {
      if (zipEntry.dir) continue;

      const relativePath = normalizePath(path);
      const parts = relativePath.split("/").filter(Boolean);
      const fileName = parts[parts.length - 1] || relativePath;

      entries.push({
        name: fileName,
        relativePath,
        sourceType: "zip",
        getArrayBuffer: () => zipEntry.async("arraybuffer")
      });
    }

    log(`ZIP contains ${entries.length} files.`);

    isLoadingSource = false;
    updateControlState();

    await commitSelectedEntries(entries, {
      type: sourceType,
      name: zipFile.name,
      totalFiles: entries.length
    });
  } catch (error) {
    selectedEntries = [];
    selectedSource = null;

    const message = error instanceof Error
      ? error.message
      : String(error);

    setOverallStatus("error", `The ZIP file could not be read: ${message}`);
    elements.selectionSummary.textContent = "No folder or ZIP file selected.";
    log(`ERROR reading ZIP: ${message}`);
  } finally {
    isLoadingSource = false;
    updateControlState();
  }
}

async function handleZipSelection(event) {
  const zipFile = event.target.files?.[0] || null;
  elements.folderInput.value = "";

  if (!zipFile) {
    previewRunId += 1;
    selectedEntries = [];
    selectedSource = null;
    resetPreviewState();
    refreshValidation();
    return;
  }

  await loadZipFile(zipFile, "zip");
}

/* ==========================================================
   Drag-and-drop folder / ZIP support
   ========================================================== */

function getFileFromEntry(fileEntry) {
  return new Promise((resolve, reject) => {
    fileEntry.file(resolve, reject);
  });
}

function readDirectoryBatch(reader) {
  return new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
}

async function collectDroppedEntry(fileSystemEntry, parentPath, collected) {
  if (fileSystemEntry.isFile) {
    const file = await getFileFromEntry(fileSystemEntry);
    const relativePath = normalizePath(`${parentPath}${fileSystemEntry.name}`);

    collected.push({
      name: file.name,
      relativePath,
      sourceType: "drop",
      getArrayBuffer: () => file.arrayBuffer()
    });
    return;
  }

  if (!fileSystemEntry.isDirectory) {
    return;
  }

  const directoryPath = `${parentPath}${fileSystemEntry.name}/`;
  const reader = fileSystemEntry.createReader();

  while (true) {
    const batch = await readDirectoryBatch(reader);
    if (!batch.length) break;

    for (const child of batch) {
      await collectDroppedEntry(child, directoryPath, collected);
    }
  }
}

async function handleDrop(event) {
  event.preventDefault();
  elements.dropZone.classList.remove("drag-over");

  if (isLoadingSource || isProcessing) {
    return;
  }

  elements.folderInput.value = "";
  elements.zipInput.value = "";

  const dataTransfer = event.dataTransfer;
  const items = Array.from(dataTransfer?.items || []);
  const fileSystemEntries = items
    .map(item => {
      if (typeof item.webkitGetAsEntry === "function") {
        return item.webkitGetAsEntry();
      }
      return null;
    })
    .filter(Boolean);

  try {
    if (fileSystemEntries.length === 1 && fileSystemEntries[0].isFile) {
      const droppedFile = await getFileFromEntry(fileSystemEntries[0]);

      if (/\.zip$/i.test(droppedFile.name)) {
        await loadZipFile(droppedFile, "zip");
        return;
      }
    }

    const directoryEntries = fileSystemEntries.filter(entry => entry.isDirectory);

    if (directoryEntries.length > 0) {
      const collected = [];

      setProgress(0, 1, "Reading dropped folder...");
      log("Reading dropped folder contents...");

      for (const fileSystemEntry of fileSystemEntries) {
        await collectDroppedEntry(fileSystemEntry, "", collected);
      }

      const sourceName = directoryEntries.length === 1
        ? directoryEntries[0].name
        : `${directoryEntries.length} dropped folders`;

      await commitSelectedEntries(collected, {
        type: "drop",
        name: sourceName,
        totalFiles: collected.length
      });
      return;
    }

    const droppedFiles = Array.from(dataTransfer?.files || []);

    if (droppedFiles.length === 1 && /\.zip$/i.test(droppedFiles[0].name)) {
      await loadZipFile(droppedFiles[0], "zip");
      return;
    }

    setOverallStatus(
      "warning",
      "That drag-and-drop selection did not include a readable folder or ZIP. Use Choose GST parent folder if your browser does not support folder drag-and-drop."
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : String(error);

    setOverallStatus("error", `The dropped folder could not be read: ${message}`);
    log(`ERROR reading dropped folder: ${message}`);
  }
}

/* ==========================================================
   CSV and ZIP path helpers
   ========================================================== */

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildAuditCsv(rows) {
  const headers = [
    "Source Type",
    "Source Name",
    "Source Folder",
    "Original Path",
    "Original File",
    "Output File",
    "Document Type",
    "Period Start",
    "Period End",
    "Unit",
    "Detection Method",
    "Status",
    "Message"
  ];

  const csvRows = [headers.map(escapeCsv).join(",")];

  for (const row of rows) {
    csvRows.push([
      row.sourceType,
      row.sourceName,
      row.sourceFolder,
      row.originalPath,
      row.originalFile,
      row.outputFile,
      row.documentType,
      row.periodStart,
      row.periodEnd,
      row.unitNumber,
      row.detectionMethod,
      row.status,
      row.message
    ].map(escapeCsv).join(","));
  }

  return `\ufeff${csvRows.join("\r\n")}`;
}

function makeUniqueZipPath(basePath, usedPaths, sourceFolder) {
  const normalized = normalizePath(basePath);
  const lower = normalized.toLowerCase();

  if (!usedPaths.has(lower)) {
    usedPaths.add(lower);
    return normalized;
  }

  const slashIndex = normalized.lastIndexOf("/");
  const directory = slashIndex >= 0
    ? normalized.slice(0, slashIndex + 1)
    : "";
  const fileName = slashIndex >= 0
    ? normalized.slice(slashIndex + 1)
    : normalized;
  const extensionIndex = fileName.toLowerCase().lastIndexOf(".pdf");
  const baseName = extensionIndex >= 0
    ? fileName.slice(0, extensionIndex)
    : fileName;
  const extension = extensionIndex >= 0
    ? fileName.slice(extensionIndex)
    : "";
  const safeFolder = sourceFolder || "duplicate";

  let counter = 1;
  let candidate;

  do {
    const suffix = counter === 1
      ? `_${safeFolder}`
      : `_${safeFolder}_${counter}`;

    candidate = `${directory}${baseName}${suffix}${extension}`;
    counter += 1;
  } while (usedPaths.has(candidate.toLowerCase()));

  usedPaths.add(candidate.toLowerCase());
  return candidate;
}

/* ==========================================================
   Main output processing
   ========================================================== */

async function processSelectedSource() {
  const analysis = analyzeEntries(selectedEntries);

  if (!selectedSource || !analysis.matchingEntries.length) {
    setOverallStatus("warning", "Choose a GST parent folder or ZIP file first.");
    return;
  }

  if (!previewReady) {
    setOverallStatus(
      "warning",
      "Wait for automatic pay-period detection and the rename preview to finish first."
    );
    return;
  }

  if (!elements.structuredOption.checked && !elements.flatOption.checked) {
    setOverallStatus(
      "warning",
      "Select at least one output folder option."
    );
    return;
  }

  if (!window.JSZip) {
    setOverallStatus(
      "error",
      "JSZip did not load. Check your internet connection and reload the page."
    );
    return;
  }

  const expectedMonths = Number(elements.monthsInput.value);

  if (!Number.isInteger(expectedMonths) || expectedMonths < 1) {
    setOverallStatus("warning", "Enter a valid number of months.");
    return;
  }

  clearGeneratedOutput();
  elements.processingLog.textContent = "Ready.";
  isProcessing = true;
  updateControlState();
  setOverallStatus("neutral", "Creating output ZIP...");

  const zip = new window.JSZip();
  const usedZipPaths = new Set();
  const auditRows = [];
  let processingErrors = 0;
  let processedCount = 0;

  log(
    `Selected ${selectedSource.type}: ${selectedSource.name}. `
    + `Creating output from ${analysis.matchingEntries.length} matching PDFs.`
  );

  for (
    let index = 0;
    index < analysis.matchingEntries.length;
    index += 1
  ) {
    const entry = analysis.matchingEntries[index];
    const preview = previewByEntryKey.get(entryKey(entry));
    const relativePath = entry.relativePath;
    const sourceFolder = entry.sourceFolder;
    const documentType = entry.documentType;

    setProgress(
      index,
      Math.max(analysis.matchingEntries.length, 1),
      `Adding ${index + 1} of ${analysis.matchingEntries.length}: ${entry.name}`
    );

    let outputFileName = entry.name;
    let period = preview?.period || null;
    let unitNumber = preview?.unitNumber || "";
    let detectionMethod = preview?.detectionMethod || "Not detected";

    try {
      if (elements.renameOption.checked) {
        if (!preview || preview.status !== "Ready") {
          throw new Error(
            preview?.message || "The rename preview was not available for this PDF."
          );
        }

        outputFileName = preview.proposedFileName;
      }

      const sourceBuffer = await entry.getArrayBuffer();
      const sourceBytes = new Uint8Array(sourceBuffer);

      if (elements.structuredOption.checked) {
        const structuredPath = makeUniqueZipPath(
          `Extracted_FUEL_STATEMENT/${sourceFolder}/${outputFileName}`,
          usedZipPaths,
          sourceFolder
        );

        zip.file(structuredPath, sourceBytes);
      }

      if (elements.flatOption.checked) {
        const flatPath = makeUniqueZipPath(
          `Extracted_FUEL_STATEMENT_FLAT/${outputFileName}`,
          usedZipPaths,
          sourceFolder
        );

        zip.file(flatPath, sourceBytes);
      }

      auditRows.push({
        sourceType: selectedSource.type,
        sourceName: selectedSource.name,
        sourceFolder,
        originalPath: relativePath,
        originalFile: entry.name,
        outputFile: outputFileName,
        documentType,
        periodStart: period ? dateKey(period.startDate) : "",
        periodEnd: period ? dateKey(period.endDate) : "",
        unitNumber,
        detectionMethod,
        status: "Processed",
        message: ""
      });

      processedCount += 1;
      log(`Processed ${relativePath} -> ${outputFileName}`);
    } catch (error) {
      processingErrors += 1;
      const message = error instanceof Error
        ? error.message
        : String(error);

      auditRows.push({
        sourceType: selectedSource.type,
        sourceName: selectedSource.name,
        sourceFolder,
        originalPath: relativePath,
        originalFile: entry.name,
        outputFile: "",
        documentType,
        periodStart: period ? dateKey(period.startDate) : "",
        periodEnd: period ? dateKey(period.endDate) : "",
        unitNumber,
        detectionMethod,
        status: "Error",
        message
      });

      log(`ERROR ${relativePath}: ${message}`);
    }
  }

  const folderIssueCount = renderFolderValidation(analysis.folderMap);
  const datedFolderCount = analysis.folderMap.size;
  const matchingCount = analysis.matchingEntries.length;
  const expectedFolderCount = expectedMonths * 2;
  const expectedPdfCount = expectedMonths * 4;

  elements.folderCount.textContent = String(datedFolderCount);
  elements.pdfCount.textContent = String(matchingCount);
  elements.issueCount.textContent = String(folderIssueCount);
  elements.errorCount.textContent = String(processingErrors);

  if (elements.auditOption.checked) {
    zip.file(
      "GST_FUEL_STATEMENT_Audit_Log.csv",
      buildAuditCsv(auditRows)
    );
  }

  if (analysis.matchingOutsideDatedFolders.length > 0) {
    zip.file(
      "Matching_PDFs_Outside_Dated_Folders.txt",
      "These matching PDFs were not processed because they were not directly "
      + "inside a valid 8-digit dated folder:\r\n\r\n"
      + analysis.matchingOutsideDatedFolders
        .map(entry => entry.relativePath)
        .join("\r\n")
    );
  }

  const periodChecksPassed =
    periodSummary.missingPeriodCount === 0
    && periodSummary.incompletePeriodCount === 0
    && periodSummary.duplicatePeriodCount === 0;

  const countChecksPassed =
    datedFolderCount === expectedFolderCount
    && matchingCount === expectedPdfCount;

  const allChecksPassed =
    countChecksPassed
    && folderIssueCount === 0
    && processingErrors === 0
    && periodChecksPassed;

  log(
    `Expected ${expectedFolderCount} dated folders and `
    + `${expectedPdfCount} matching PDFs.`
  );
  log(
    `Found ${datedFolderCount} dated folders and `
    + `${matchingCount} matching PDFs.`
  );
  log(`Added ${processedCount} PDFs to the output ZIP.`);

  if (allChecksPassed) {
    setOverallStatus(
      "success",
      `Passed: ${datedFolderCount} dated folders, ${matchingCount} matching PDFs, and all expected pay periods are complete. Output ZIP is being built.`
    );
  } else {
    const messages = [];

    if (datedFolderCount !== expectedFolderCount) {
      messages.push(
        `found ${datedFolderCount} dated folders; expected ${expectedFolderCount}`
      );
    }

    if (matchingCount !== expectedPdfCount) {
      messages.push(
        `found ${matchingCount} matching PDFs; expected ${expectedPdfCount}`
      );
    }

    if (folderIssueCount > 0) {
      messages.push(
        `${folderIssueCount} folder(s) do not have exactly 1 FUEL and 1 STATEMENT`
      );
    }

    if (periodSummary.missingPeriodCount > 0) {
      messages.push(`${periodSummary.missingPeriodCount} pay period(s) are completely missing`);
    }

    if (periodSummary.incompletePeriodCount > 0) {
      messages.push(`${periodSummary.incompletePeriodCount} pay period(s) are incomplete`);
    }

    if (periodSummary.duplicatePeriodCount > 0) {
      messages.push(`${periodSummary.duplicatePeriodCount} pay period(s) have duplicate files`);
    }

    if (processingErrors > 0) {
      messages.push(`${processingErrors} PDF processing error(s)`);
    }

    setOverallStatus(
      "warning",
      `Review needed: ${messages.join("; ")}. Output ZIP is being built with the files that processed successfully.`
    );
  }

  try {
    setProgress(
      analysis.matchingEntries.length,
      Math.max(analysis.matchingEntries.length, 1),
      "Building ZIP file..."
    );

    generatedZipBlob = await zip.generateAsync(
      {
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 }
      },
      metadata => {
        elements.progressBar.value = metadata.percent;
        elements.progressText.textContent =
          `Building ZIP: ${Math.round(metadata.percent)}%`;
      }
    );

    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/T/, "_")
      .slice(0, 15);

    generatedZipName = `GST_FUEL_STATEMENT_${stamp}.zip`;
    elements.downloadButton.disabled = processedCount === 0;
    setProgress(1, 1, processedCount > 0 ? "Ready to download" : "No files processed");
    log(`ZIP ready: ${generatedZipName}`);
  } catch (error) {
    processingErrors += 1;
    elements.errorCount.textContent = String(processingErrors);

    const message = error instanceof Error
      ? error.message
      : String(error);

    setOverallStatus(
      "error",
      `Could not build the ZIP file: ${message}`
    );
    log(`ERROR building ZIP: ${message}`);
  } finally {
    isProcessing = false;
    updateControlState();
  }
}

function downloadGeneratedZip() {
  if (!generatedZipBlob || !generatedZipName) return;

  const url = URL.createObjectURL(generatedZipBlob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = generatedZipName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ==========================================================
   Help dialog
   ========================================================== */

let helpPreviousFocus = null;

function openHelp() {
  if (!elements.helpModal) return;

  helpPreviousFocus = document.activeElement;
  elements.helpModal.classList.add("is-open");
  elements.helpModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");

  window.setTimeout(() => {
    elements.helpCloseButton?.focus();
  }, 0);
}

function closeHelp() {
  if (!elements.helpModal) return;

  elements.helpModal.classList.remove("is-open");
  elements.helpModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  if (helpPreviousFocus && typeof helpPreviousFocus.focus === "function") {
    helpPreviousFocus.focus();
  }
}

function trapHelpFocus(event) {
  if (
    event.key !== "Tab"
    || !elements.helpModal?.classList.contains("is-open")
  ) {
    return;
  }

  const focusable = Array.from(
    elements.helpModal.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(element => element.offsetParent !== null);

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ==========================================================
   Reset and event listeners
   ========================================================== */

function resetResults() {
  clearGeneratedOutput();
  elements.folderCount.textContent = "0";
  elements.pdfCount.textContent = "0";
  elements.issueCount.textContent = "0";
  elements.errorCount.textContent = "0";
  setEmptyTable(elements.folderResultsBody, 5, "No results yet.");
  elements.processingLog.textContent = "Ready.";
  elements.progressBar.value = 0;
  elements.progressText.textContent = "Ready";
  setOverallStatus("neutral", "Select a folder or ZIP file to begin.");
}

function resetApplication() {
  previewRunId += 1;

  elements.folderInput.value = "";
  elements.zipInput.value = "";
  elements.monthsInput.value = DEFAULT_MONTHS;
  elements.monthsHelper.textContent =
    "Automatically updated after the PDF pay periods are detected. You can still override the value.";
  elements.structuredOption.checked = true;
  elements.flatOption.checked = true;
  elements.renameOption.checked = true;
  elements.auditOption.checked = true;

  selectedEntries = [];
  selectedSource = null;
  isLoadingSource = false;
  isPreviewing = false;
  isProcessing = false;

  elements.selectionSummary.textContent =
    "No folder or ZIP file selected.";
  elements.dropZone.classList.remove("drag-over", "is-busy");

  resetPreviewState();
  resetResults();
  updateControlState();
}

if (elements.pennerLogo && elements.logoFallback) {
  elements.pennerLogo.addEventListener("error", () => {
    elements.pennerLogo.style.display = "none";
    elements.logoFallback.style.display = "grid";
  });

  elements.pennerLogo.addEventListener("load", () => {
    elements.logoFallback.style.display = "none";
    elements.pennerLogo.style.display = "block";
  });
}

if (
  elements.helpButton
  && elements.helpModal
  && elements.helpCloseButton
  && elements.helpDoneButton
) {
  elements.helpButton.addEventListener("click", openHelp);
  elements.helpCloseButton.addEventListener("click", closeHelp);
  elements.helpDoneButton.addEventListener("click", closeHelp);

  elements.helpModal.addEventListener("click", event => {
    if (event.target instanceof HTMLElement && event.target.dataset.helpClose === "true") {
      closeHelp();
    }
  });

  document.addEventListener("keydown", event => {
    if (!elements.helpModal.classList.contains("is-open")) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeHelp();
      return;
    }

    trapHelpFocus(event);
  });
}

elements.folderInput.addEventListener("change", handleFolderSelection);
elements.zipInput.addEventListener("change", handleZipSelection);

elements.monthsInput.addEventListener("input", () => {
  elements.monthsHelper.textContent =
    `Manual expected-month setting: ${elements.monthsInput.value || "—"}. Select new files to auto-detect again.`;
  refreshValidation();
});

elements.processButton.addEventListener("click", processSelectedSource);
elements.downloadButton.addEventListener("click", downloadGeneratedZip);
elements.resetButton.addEventListener("click", resetApplication);

elements.dropZone.addEventListener("dragenter", event => {
  event.preventDefault();
  if (!isProcessing && !isLoadingSource) {
    elements.dropZone.classList.add("drag-over");
  }
});

elements.dropZone.addEventListener("dragover", event => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  if (!isProcessing && !isLoadingSource) {
    elements.dropZone.classList.add("drag-over");
  }
});

elements.dropZone.addEventListener("dragleave", event => {
  if (!elements.dropZone.contains(event.relatedTarget)) {
    elements.dropZone.classList.remove("drag-over");
  }
});

elements.dropZone.addEventListener("drop", handleDrop);

resetPreviewState();
updateControlState();

if (!window.JSZip || !window.pdfjsLib) {
  setOverallStatus(
    "warning",
    "Loading browser libraries. If this message remains, check your internet connection and reload the page."
  );
}

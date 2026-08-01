"use strict";

/* ==========================================================
   GST FUEL and STATEMENT File Extractor

   This version keeps the original, reliable PDF date-renaming
   logic and adds support for selecting either:

   1. A normal GST parent folder, or
   2. A GST ZIP file
   ========================================================== */

const PDFJS_VERSION = "3.11.174";
const PDFJS_WORKER =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
}

const elements = {
  folderInput: document.getElementById("folderInput"),
  zipInput: document.getElementById("zipInput"),
  monthsInput: document.getElementById("monthsInput"),
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
  folderCount: document.getElementById("folderCount"),
  pdfCount: document.getElementById("pdfCount"),
  issueCount: document.getElementById("issueCount"),
  errorCount: document.getElementById("errorCount"),
  overallStatus: document.getElementById("overallStatus"),
  folderResultsBody: document.getElementById("folderResultsBody"),
  processingLog: document.getElementById("processingLog"),
  pennerLogo: document.getElementById("pennerLogo"),
  logoFallback: document.getElementById("logoFallback")
};

const DEFAULT_MONTHS = elements.monthsInput?.defaultValue || "3";

let selectedEntries = [];
let selectedSource = null;
let generatedZipBlob = null;
let generatedZipName = "";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
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

function setBusyState(isBusy) {
  elements.folderInput.disabled = isBusy;
  elements.zipInput.disabled = isBusy;
  elements.monthsInput.disabled = isBusy;
  elements.structuredOption.disabled = isBusy;
  elements.flatOption.disabled = isBusy;
  elements.renameOption.disabled = isBusy;
  elements.auditOption.disabled = isBusy;
  elements.resetButton.disabled = isBusy;

  const analysis = analyzeEntries(selectedEntries);
  elements.processButton.disabled =
    isBusy || analysis.matchingEntries.length === 0;
}

function clearGeneratedOutput() {
  generatedZipBlob = null;
  generatedZipName = "";
  elements.downloadButton.disabled = true;
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

  // The PDF must be directly inside an 8-digit dated folder.
  // This works for all of these:
  //   GST Folder/20260430/file.pdf
  //   Outer Folder/GST Folder/20260430/file.pdf
  //   20260430/file.pdf
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
   Original PDF date and unit extraction logic
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
  // Use the original filename first. This prevents words such as ING or USX
  // from being mistaken for the unit number.
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
   Source selection: normal folder
   ========================================================== */

function handleFolderSelection(event) {
  const files = Array.from(event.target.files || []);

  clearGeneratedOutput();
  elements.zipInput.value = "";

  if (!files.length) {
    selectedEntries = [];
    selectedSource = null;
    refreshValidation();
    return;
  }

  selectedEntries = files.map(file => ({
    name: file.name,
    relativePath: normalizePath(file.webkitRelativePath || file.name),
    sourceType: "folder",
    getArrayBuffer: () => file.arrayBuffer()
  }));

  const firstPath = selectedEntries[0].relativePath;
  const rootFolder = firstPath.split("/")[0] || "Selected folder";

  selectedSource = {
    type: "folder",
    name: rootFolder,
    totalFiles: selectedEntries.length
  };

  elements.processingLog.textContent = "Ready.";
  log(`Selected folder: ${rootFolder}`);
  refreshValidation();
}

/* ==========================================================
   Source selection: ZIP file
   ========================================================== */

async function handleZipSelection(event) {
  const zipFile = event.target.files?.[0] || null;

  clearGeneratedOutput();
  elements.folderInput.value = "";

  if (!zipFile) {
    selectedEntries = [];
    selectedSource = null;
    refreshValidation();
    return;
  }

  if (!window.JSZip) {
    setOverallStatus(
      "error",
      "JSZip did not load. Check your internet connection and reload the page."
    );
    return;
  }

  setBusyState(true);
  elements.progressText.textContent = "Reading ZIP file...";
  elements.processingLog.textContent = "Ready.";
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

    selectedEntries = entries;
    selectedSource = {
      type: "zip",
      name: zipFile.name,
      totalFiles: entries.length
    };

    log(`ZIP contains ${entries.length} files.`);
    refreshValidation();
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
    setBusyState(false);
    elements.progressText.textContent = "Ready";
  }
}

/* ==========================================================
   Validation
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

function refreshValidation() {
  clearGeneratedOutput();

  const analysis = analyzeEntries(selectedEntries);
  const folderIssueCount = renderFolderValidation(analysis.folderMap);
  const datedFolderCount = analysis.folderMap.size;
  const matchingCount = analysis.matchingEntries.length;

  elements.folderCount.textContent = String(datedFolderCount);
  elements.pdfCount.textContent = String(matchingCount);
  elements.issueCount.textContent = String(folderIssueCount);
  elements.errorCount.textContent = "0";

  if (!selectedSource) {
    elements.selectionSummary.textContent = "No folder or ZIP file selected.";
    elements.processButton.disabled = true;
    setOverallStatus("neutral", "Select a folder or ZIP file to begin.");
    return;
  }

  const sourceLabel = selectedSource.type === "zip" ? "ZIP" : "Folder";
  elements.selectionSummary.textContent =
    `${sourceLabel}: ${selectedSource.name} — `
    + `${selectedSource.totalFiles} total files, `
    + `${matchingCount} matching PDFs, `
    + `${datedFolderCount} dated folders.`;

  elements.processButton.disabled = matchingCount === 0;

  if (matchingCount === 0) {
    setOverallStatus(
      "warning",
      "No PDFs ending exactly in _FUEL.pdf or _STATEMENT.pdf were found directly inside valid 8-digit dated folders."
    );
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

  if (messages.length === 0) {
    setOverallStatus(
      "success",
      `Validation passed: found ${datedFolderCount} dated folders and ${matchingCount} matching PDFs.`
    );
  } else {
    setOverallStatus("warning", `Review needed: ${messages.join("; ")}.`);
  }
}

function renderFolderValidation(folderMap) {
  const entries = [...folderMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b));

  elements.folderResultsBody.replaceChildren();

  if (!entries.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "empty-state";
    cell.textContent = "No dated folders found.";
    row.appendChild(cell);
    elements.folderResultsBody.appendChild(row);
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
   Main processing
   ========================================================== */

async function processSelectedSource() {
  const analysis = analyzeEntries(selectedEntries);

  if (!selectedSource || !analysis.matchingEntries.length) {
    setOverallStatus("warning", "Choose a GST parent folder or ZIP file first.");
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

  if (elements.renameOption.checked && !window.pdfjsLib) {
    setOverallStatus(
      "error",
      "PDF.js did not load. Check your internet connection and reload the page."
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
  setBusyState(true);
  setOverallStatus("neutral", "Processing files...");

  const zip = new window.JSZip();
  const usedZipPaths = new Set();
  const auditRows = [];
  let processingErrors = 0;

  log(
    `Selected ${selectedSource.type}: ${selectedSource.name}. `
    + `Processing ${analysis.matchingEntries.length} matching PDFs.`
  );

  for (
    let index = 0;
    index < analysis.matchingEntries.length;
    index += 1
  ) {
    const entry = analysis.matchingEntries[index];
    const relativePath = entry.relativePath;
    const sourceFolder = entry.sourceFolder;
    const documentType = entry.documentType;

    setProgress(
      index,
      Math.max(analysis.matchingEntries.length, 1),
      `Reviewing ${index + 1} of ${analysis.matchingEntries.length}: ${entry.name}`
    );

    let outputFileName = entry.name;
    let period = null;
    let unitNumber = "";
    let detectionMethod = "Not requested";

    try {
      const sourceBuffer = await entry.getArrayBuffer();
      const sourceBytes = new Uint8Array(sourceBuffer);

      if (elements.renameOption.checked) {
        // Use a copy for PDF.js so the original bytes remain available
        // for the output ZIP.
        const text = await extractPdfText(sourceBytes.slice());
        period = getDocumentPeriod(text, documentType);

        if (!period) {
          throw new Error(
            "Period start and end dates were not detected."
          );
        }

        if (compareDocumentDates(period.startDate, period.endDate) > 0) {
          throw new Error(
            "Detected period start is after period end."
          );
        }

        unitNumber = getUnitNumber(entry.name, text);
        detectionMethod = period.method;
        outputFileName = buildRenamedFileName(
          period,
          unitNumber,
          documentType
        );
      }

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

      log(
        `Processed ${relativePath} -> ${outputFileName}`
      );
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
        periodStart: "",
        periodEnd: "",
        unitNumber: "",
        detectionMethod: "",
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

  const countChecksPassed =
    datedFolderCount === expectedFolderCount
    && matchingCount === expectedPdfCount;
  const allChecksPassed =
    countChecksPassed
    && folderIssueCount === 0
    && processingErrors === 0;

  log(
    `Expected ${expectedFolderCount} dated folders and `
    + `${expectedPdfCount} matching PDFs.`
  );
  log(
    `Found ${datedFolderCount} dated folders and `
    + `${matchingCount} matching PDFs.`
  );

  if (allChecksPassed) {
    setOverallStatus(
      "success",
      `Passed: found ${datedFolderCount} dated folders and `
      + `${matchingCount} matching PDFs, with 1 FUEL and 1 STATEMENT `
      + "in every folder."
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

    if (processingErrors > 0) {
      messages.push(`${processingErrors} PDF processing error(s)`);
    }

    setOverallStatus(
      "warning",
      `Review needed: ${messages.join("; ")}.`
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
    elements.downloadButton.disabled = false;
    setProgress(1, 1, "Ready to download");
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
    setBusyState(false);
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
   Reset and event listeners
   ========================================================== */

function resetResults() {
  clearGeneratedOutput();
  elements.folderCount.textContent = "0";
  elements.pdfCount.textContent = "0";
  elements.issueCount.textContent = "0";
  elements.errorCount.textContent = "0";
  elements.folderResultsBody.innerHTML =
    '<tr><td colspan="5" class="empty-state">No results yet.</td></tr>';
  elements.processingLog.textContent = "Ready.";
  elements.progressBar.value = 0;
  elements.progressText.textContent = "Ready";
  setOverallStatus("neutral", "Select a folder or ZIP file to begin.");
}

function resetApplication() {
  elements.folderInput.value = "";
  elements.zipInput.value = "";
  elements.monthsInput.value = DEFAULT_MONTHS;
  elements.structuredOption.checked = true;
  elements.flatOption.checked = true;
  elements.renameOption.checked = true;
  elements.auditOption.checked = true;

  selectedEntries = [];
  selectedSource = null;

  elements.selectionSummary.textContent =
    "No folder or ZIP file selected.";
  elements.processButton.disabled = true;

  resetResults();
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

elements.folderInput.addEventListener("change", handleFolderSelection);
elements.zipInput.addEventListener("change", handleZipSelection);
elements.monthsInput.addEventListener("input", refreshValidation);
elements.processButton.addEventListener("click", processSelectedSource);
elements.downloadButton.addEventListener("click", downloadGeneratedZip);
elements.resetButton.addEventListener("click", resetApplication);

if (!window.JSZip || !window.pdfjsLib) {
  setOverallStatus(
    "warning",
    "Loading browser libraries. If this message remains, check your internet connection and reload the page."
  );
}

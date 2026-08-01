"use strict";

/* ==========================================================
   GST FUEL and STATEMENT File Extractor
   Supports either:
   1. A selected parent folder, or
   2. A selected ZIP file
   ========================================================== */

const PDF_WORKER_URL =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
}

const elements = {
  folderInput: document.getElementById("folderInput"),
  zipInput: document.getElementById("zipInput"),
  selectionSummary: document.getElementById("selectionSummary"),
  monthsInput: document.getElementById("monthsInput"),
  structuredOption: document.getElementById("structuredOption"),
  flatOption: document.getElementById("flatOption"),
  renameOption: document.getElementById("renameOption"),
  auditOption: document.getElementById("auditOption"),
  processButton: document.getElementById("processButton"),
  resetButton: document.getElementById("resetButton"),
  downloadButton: document.getElementById("downloadButton"),
  progressBar: document.getElementById("progressBar"),
  progressText: document.getElementById("progressText"),
  folderCount: document.getElementById("folderCount"),
  pdfCount: document.getElementById("pdfCount"),
  issueCount: document.getElementById("issueCount"),
  errorCount: document.getElementById("errorCount"),
  overallStatus: document.getElementById("overallStatus"),
  folderResultsBody: document.getElementById("folderResultsBody"),
  processingLog: document.getElementById("processingLog")
};

let selectedEntries = [];
let selectedSource = null;
let generatedZipBlob = null;
let generatedZipName = "";
let logLines = [];

/* ==========================================================
   Event listeners
   ========================================================== */

elements.folderInput.addEventListener("change", handleFolderSelection);
elements.zipInput.addEventListener("change", handleZipSelection);
elements.monthsInput.addEventListener("input", refreshValidation);
elements.processButton.addEventListener("click", processSelectedSource);
elements.downloadButton.addEventListener("click", downloadGeneratedZip);
elements.resetButton.addEventListener("click", resetApplication);

/* ==========================================================
   Source selection
   ========================================================== */

function handleFolderSelection(event) {
  const files = Array.from(event.target.files || []);

  clearGeneratedOutput();
  elements.zipInput.value = "";

  if (files.length === 0) {
    selectedEntries = [];
    selectedSource = null;
    refreshValidation();
    return;
  }

  selectedEntries = files.map((file) => ({
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

  addLog(`Selected folder: ${rootFolder}`);
  addLog(`Files available to the browser: ${selectedEntries.length}`);
  refreshValidation();
}

async function handleZipSelection(event) {
  const zipFile = event.target.files && event.target.files[0];

  clearGeneratedOutput();
  elements.folderInput.value = "";

  if (!zipFile) {
    selectedEntries = [];
    selectedSource = null;
    refreshValidation();
    return;
  }

  if (!window.JSZip) {
    showApplicationError(
      "JSZip did not load. Check your internet connection and reload the page."
    );
    return;
  }

  setBusyState(true, "Reading ZIP file...");
  addLog(`Opening ZIP file: ${zipFile.name}`);

  try {
    const inputZip = await JSZip.loadAsync(zipFile);
    const entries = [];

    Object.keys(inputZip.files).forEach((path) => {
      const zipEntry = inputZip.files[path];

      if (zipEntry.dir) {
        return;
      }

      const normalizedPath = normalizePath(path);
      const pathParts = normalizedPath.split("/");
      const fileName = pathParts[pathParts.length - 1];

      entries.push({
        name: fileName,
        relativePath: normalizedPath,
        sourceType: "zip",
        getArrayBuffer: () => zipEntry.async("arraybuffer")
      });
    });

    selectedEntries = entries;
    selectedSource = {
      type: "zip",
      name: zipFile.name,
      totalFiles: entries.length
    };

    addLog(`ZIP entries available to the browser: ${entries.length}`);
    refreshValidation();
  } catch (error) {
    selectedEntries = [];
    selectedSource = null;
    showApplicationError(`The ZIP file could not be read: ${error.message}`);
    addLog(`ZIP error: ${error.message}`);
  } finally {
    setBusyState(false, "Ready");
  }
}

/* ==========================================================
   Validation
   ========================================================== */

function refreshValidation() {
  clearGeneratedOutput();

  const analysis = analyzeEntries(selectedEntries);
  renderValidation(analysis, 0);

  if (!selectedSource) {
    elements.selectionSummary.textContent =
      "No folder or ZIP file selected.";
  } else {
    const sourceLabel = selectedSource.type === "zip" ? "ZIP" : "Folder";
    elements.selectionSummary.textContent =
      `${sourceLabel}: ${selectedSource.name} — ` +
      `${selectedSource.totalFiles} total files, ` +
      `${analysis.matchingEntries.length} matching PDFs.`;
  }

  elements.processButton.disabled = analysis.matchingEntries.length === 0;
}

function analyzeEntries(entries) {
  const groups = new Map();
  const matchingOutsideDatedFolders = [];

  entries.forEach((entry) => {
    const documentType = getDocumentType(entry.name);

    if (!documentType) {
      return;
    }

    const datedFolder = findDatedFolder(entry.relativePath);

    if (!datedFolder) {
      matchingOutsideDatedFolders.push({
        ...entry,
        documentType
      });
      return;
    }

    if (!groups.has(datedFolder)) {
      groups.set(datedFolder, {
        datedFolder,
        fuelEntries: [],
        statementEntries: []
      });
    }

    const group = groups.get(datedFolder);
    const preparedEntry = {
      ...entry,
      datedFolder,
      documentType
    };

    if (documentType === "FUEL") {
      group.fuelEntries.push(preparedEntry);
    } else {
      group.statementEntries.push(preparedEntry);
    }
  });

  const folders = Array.from(groups.values())
    .sort((a, b) => a.datedFolder.localeCompare(b.datedFolder))
    .map((group) => {
      const fuelCount = group.fuelEntries.length;
      const statementCount = group.statementEntries.length;
      const total = fuelCount + statementCount;
      const issues = [];

      if (fuelCount === 0) {
        issues.push("Missing FUEL");
      } else if (fuelCount > 1) {
        issues.push(`${fuelCount} FUEL files`);
      }

      if (statementCount === 0) {
        issues.push("Missing STATEMENT");
      } else if (statementCount > 1) {
        issues.push(`${statementCount} STATEMENT files`);
      }

      return {
        ...group,
        fuelCount,
        statementCount,
        total,
        issues,
        status: issues.length === 0 ? "OK" : issues.join("; ")
      };
    });

  const matchingEntries = folders.flatMap((folder) => [
    ...folder.fuelEntries,
    ...folder.statementEntries
  ]);

  const monthsExpected = clampInteger(elements.monthsInput.value, 1, 60, 3);
  const expectedFolders = monthsExpected * 2;
  const expectedPdfs = monthsExpected * 4;
  const issueFolderCount = folders.filter(
    (folder) => folder.issues.length > 0
  ).length;

  const validationMessages = [];

  if (folders.length !== expectedFolders) {
    validationMessages.push(
      `Expected ${expectedFolders} dated folders but found ${folders.length}`
    );
  }

  if (matchingEntries.length !== expectedPdfs) {
    validationMessages.push(
      `Expected ${expectedPdfs} matching PDFs but found ${matchingEntries.length}`
    );
  }

  if (issueFolderCount > 0) {
    validationMessages.push(
      `${issueFolderCount} dated folder${issueFolderCount === 1 ? " has" : "s have"} file issues`
    );
  }

  if (matchingOutsideDatedFolders.length > 0) {
    validationMessages.push(
      `${matchingOutsideDatedFolders.length} matching PDF${matchingOutsideDatedFolders.length === 1 ? " is" : "s are"} outside an 8-digit dated folder`
    );
  }

  return {
    folders,
    matchingEntries,
    matchingOutsideDatedFolders,
    monthsExpected,
    expectedFolders,
    expectedPdfs,
    issueFolderCount,
    validationMessages
  };
}

function renderValidation(analysis, processingErrors) {
  elements.folderCount.textContent = String(analysis.folders.length);
  elements.pdfCount.textContent = String(analysis.matchingEntries.length);
  elements.issueCount.textContent = String(analysis.issueFolderCount);
  elements.errorCount.textContent = String(processingErrors);

  renderFolderTable(analysis.folders);

  if (!selectedSource) {
    setOverallStatus("neutral", "Select a folder or ZIP file to begin.");
    return;
  }

  if (analysis.matchingEntries.length === 0) {
    setOverallStatus(
      "error",
      "No PDFs ending exactly in _FUEL.pdf or _STATEMENT.pdf were found inside 8-digit dated folders."
    );
    return;
  }

  if (analysis.validationMessages.length === 0) {
    setOverallStatus(
      "success",
      `Validation passed: ${analysis.folders.length} dated folders and ` +
        `${analysis.matchingEntries.length} matching PDFs found.`
    );
  } else {
    setOverallStatus("warning", analysis.validationMessages.join(". ") + ".");
  }
}

function renderFolderTable(folders) {
  elements.folderResultsBody.replaceChildren();

  if (folders.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "empty-state";
    cell.textContent = "No results yet.";
    row.appendChild(cell);
    elements.folderResultsBody.appendChild(row);
    return;
  }

  folders.forEach((folder) => {
    const row = document.createElement("tr");

    appendTableCell(row, folder.datedFolder);
    appendTableCell(row, String(folder.fuelCount));
    appendTableCell(row, String(folder.statementCount));
    appendTableCell(row, String(folder.total));

    const statusCell = document.createElement("td");
    statusCell.textContent = folder.status;
    statusCell.className =
      folder.issues.length === 0
        ? "status-text success"
        : "status-text error";
    row.appendChild(statusCell);

    elements.folderResultsBody.appendChild(row);
  });
}

function appendTableCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.appendChild(cell);
}

/* ==========================================================
   Processing and output ZIP creation
   ========================================================== */

async function processSelectedSource() {
  const analysis = analyzeEntries(selectedEntries);

  if (analysis.matchingEntries.length === 0) {
    showApplicationError("There are no matching PDFs to process.");
    return;
  }

  if (!elements.structuredOption.checked && !elements.flatOption.checked) {
    showApplicationError(
      "Select at least one output option: structured output or flat output."
    );
    return;
  }

  if (!window.JSZip) {
    showApplicationError(
      "JSZip did not load. Check your internet connection and reload the page."
    );
    return;
  }

  if (elements.renameOption.checked && !window.pdfjsLib) {
    showApplicationError(
      "PDF.js did not load. Check your internet connection and reload the page."
    );
    return;
  }

  clearGeneratedOutput();
  logLines = [];
  addLog(`Source: ${selectedSource.type} — ${selectedSource.name}`);
  addLog(
    `Processing ${analysis.matchingEntries.length} matching PDF files from ` +
      `${analysis.folders.length} dated folders.`
  );

  setBusyState(true, "Preparing files...");
  setProgress(0, "Preparing files...");

  const outputZip = new JSZip();
  const usedPaths = new Set();
  const auditRows = [];
  let processingErrors = 0;

  for (let index = 0; index < analysis.matchingEntries.length; index += 1) {
    const entry = analysis.matchingEntries[index];
    const position = index + 1;
    const baseProgress = Math.round(
      (index / analysis.matchingEntries.length) * 78
    );

    setProgress(
      baseProgress,
      `Processing ${position} of ${analysis.matchingEntries.length}: ${entry.name}`
    );

    const auditRow = {
      source_type: selectedSource.type,
      source_name: selectedSource.name,
      dated_folder: entry.datedFolder,
      original_path: entry.relativePath,
      original_name: entry.name,
      document_type: entry.documentType,
      period_start: "",
      period_end: "",
      unit: "",
      output_name: "",
      structured_path: "",
      flat_path: "",
      status: "",
      error: ""
    };

    try {
      const sourceBuffer = await entry.getArrayBuffer();
      const sourceBytes = new Uint8Array(sourceBuffer);
      let outputName = entry.name;
      let metadata = {
        periodStart: "",
        periodEnd: "",
        unit: extractUnitFromFilename(entry.name)
      };

      if (elements.renameOption.checked) {
        try {
          const pdfText = await extractPdfText(sourceBytes.slice());
          metadata = extractPdfMetadata(
            pdfText,
            entry.name,
            entry.datedFolder
          );
          outputName = buildOutputFileName(
            metadata,
            entry.documentType,
            entry.datedFolder
          );
        } catch (pdfError) {
          outputName = buildOutputFileName(
            metadata,
            entry.documentType,
            entry.datedFolder
          );
          addLog(
            `Metadata warning for ${entry.relativePath}: ${pdfError.message}. ` +
              `A fallback filename was used.`
          );
        }
      }

      auditRow.period_start = metadata.periodStart;
      auditRow.period_end = metadata.periodEnd;
      auditRow.unit = metadata.unit;
      auditRow.output_name = outputName;

      if (elements.structuredOption.checked) {
        const preferredStructuredPath =
          `Extracted_FUEL_STATEMENT/${entry.datedFolder}/${outputName}`;
        const structuredPath = createUniquePath(
          preferredStructuredPath,
          usedPaths
        );
        outputZip.file(structuredPath, sourceBytes);
        auditRow.structured_path = structuredPath;
      }

      if (elements.flatOption.checked) {
        const preferredFlatPath =
          `Extracted_FUEL_STATEMENT_FLAT/${outputName}`;
        const flatPath = createUniquePath(preferredFlatPath, usedPaths);
        outputZip.file(flatPath, sourceBytes);
        auditRow.flat_path = flatPath;
      }

      auditRow.status = "Processed";
      addLog(`Processed: ${entry.relativePath} -> ${outputName}`);
    } catch (error) {
      processingErrors += 1;
      auditRow.status = "Error";
      auditRow.error = error.message;
      addLog(`ERROR: ${entry.relativePath} — ${error.message}`);
    }

    auditRows.push(auditRow);
  }

  if (elements.auditOption.checked) {
    const auditCsv = createAuditCsv(auditRows);
    outputZip.file("GST_File_Extractor_Audit.csv", `\uFEFF${auditCsv}`);
  }

  if (analysis.matchingOutsideDatedFolders.length > 0) {
    const ignoredText = analysis.matchingOutsideDatedFolders
      .map((entry) => entry.relativePath)
      .join("\r\n");

    outputZip.file(
      "Matching_PDFs_Outside_Dated_Folders.txt",
      "These matching PDFs were not processed because they were not inside an " +
        "8-digit dated folder:\r\n\r\n" +
        ignoredText
    );
  }

  addLog("Creating the downloadable results ZIP...");

  try {
    generatedZipBlob = await outputZip.generateAsync(
      {
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
          level: 6
        }
      },
      (metadata) => {
        const zipProgress = 80 + Math.round(metadata.percent * 0.2);
        setProgress(zipProgress, `Creating ZIP: ${Math.round(metadata.percent)}%`);
      }
    );

    generatedZipName = createDownloadFileName();
    elements.downloadButton.disabled = false;
    elements.errorCount.textContent = String(processingErrors);

    const remainingValidationIssues = analysis.validationMessages.length > 0;

    if (processingErrors === 0 && !remainingValidationIssues) {
      setOverallStatus(
        "success",
        "Processing completed successfully. The results ZIP is ready to download."
      );
    } else if (processingErrors === 0) {
      setOverallStatus(
        "warning",
        "Processing completed and the ZIP is ready, but the original folder validation found issues."
      );
    } else {
      setOverallStatus(
        "warning",
        `The ZIP was created with ${processingErrors} processing error` +
          `${processingErrors === 1 ? "" : "s"}. Review the audit log.`
      );
    }

    setProgress(100, "Results ZIP ready");
    addLog(`ZIP ready: ${generatedZipName}`);
  } catch (error) {
    generatedZipBlob = null;
    generatedZipName = "";
    showApplicationError(`The output ZIP could not be created: ${error.message}`);
    addLog(`Output ZIP error: ${error.message}`);
  } finally {
    setBusyState(false, elements.progressText.textContent);
  }
}

/* ==========================================================
   PDF text and metadata extraction
   ========================================================== */

async function extractPdfText(pdfBytes) {
  const loadingTask = window.pdfjsLib.getDocument({ data: pdfBytes });
  const pdfDocument = await loadingTask.promise;
  const pageText = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      pageText.push(text);
    }
  } finally {
    await pdfDocument.destroy();
  }

  return pageText.join("\n");
}

function extractPdfMetadata(pdfText, originalName, datedFolder) {
  const cleanedText = pdfText.replace(/\s+/g, " ").trim();
  const datePattern =
    "(\\d{4}[\\/-]\\d{1,2}[\\/-]\\d{1,2}|\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{4})";

  let periodStart = findLabeledDate(cleanedText, [
    "period start",
    "start date",
    "period from"
  ], datePattern);

  let periodEnd = findLabeledDate(cleanedText, [
    "period end",
    "end date",
    "period to"
  ], datePattern);

  if (!periodStart || !periodEnd) {
    const rangeRegex = new RegExp(
      `(?:statement\\s+period|reporting\\s+period|pay\\s+period|period)` +
        `\\s*[:#-]?\\s*${datePattern}\\s*(?:to|through|thru|-)\\s*${datePattern}`,
      "i"
    );
    const rangeMatch = cleanedText.match(rangeRegex);

    if (rangeMatch) {
      periodStart = periodStart || normalizeDate(rangeMatch[1]);
      periodEnd = periodEnd || normalizeDate(rangeMatch[2]);
    }
  }

  const unitPatterns = [
    /(?:power\s*unit|unit\s*(?:number|no\.?|#)?|truck\s*(?:number|no\.?|#)?)\s*[:#-]?\s*([A-Z0-9-]{2,20})/i,
    /(?:tractor\s*(?:number|no\.?|#)?)\s*[:#-]?\s*([A-Z0-9-]{2,20})/i
  ];

  let unit = "";

  for (const pattern of unitPatterns) {
    const match = cleanedText.match(pattern);
    if (match) {
      unit = sanitizeNamePart(match[1]);
      break;
    }
  }

  if (!unit) {
    unit = extractUnitFromFilename(originalName);
  }

  return {
    periodStart,
    periodEnd,
    unit: unit || datedFolder
  };
}

function findLabeledDate(text, labels, datePattern) {
  for (const label of labels) {
    const expression = new RegExp(
      `${escapeRegExp(label)}\\s*[:#-]?\\s*${datePattern}`,
      "i"
    );
    const match = text.match(expression);

    if (match) {
      return normalizeDate(match[1]);
    }
  }

  return "";
}

function normalizeDate(value) {
  if (!value) {
    return "";
  }

  const parts = value.split(/[\/-]/).map((part) => Number(part));

  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    return "";
  }

  let year;
  let month;
  let day;

  if (String(value).split(/[\/-]/)[0].length === 4) {
    [year, month, day] = parts;
  } else {
    const [first, second, third] = parts;
    year = third;

    // Penner statements commonly use month/day/year. When the first value
    // is greater than 12, treat the date as day/month/year instead.
    if (first > 12) {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }

  return (
    String(year).padStart(4, "0") +
    String(month).padStart(2, "0") +
    String(day).padStart(2, "0")
  );
}

function extractUnitFromFilename(fileName) {
  const stem = fileName.replace(/_(FUEL|STATEMENT)\.pdf$/i, "");
  const tokens = stem
    .split(/[_\s-]+/)
    .map((token) => sanitizeNamePart(token))
    .filter(Boolean);

  if (tokens.length === 0) {
    return "";
  }

  return tokens[tokens.length - 1];
}

function buildOutputFileName(metadata, documentType, datedFolder) {
  const parts = [];

  if (metadata.periodStart && metadata.periodEnd) {
    parts.push(metadata.periodStart, metadata.periodEnd);
  } else {
    parts.push(datedFolder);
  }

  if (metadata.unit) {
    parts.push(`Unit_${sanitizeNamePart(metadata.unit)}`);
  }

  parts.push(documentType);

  return sanitizeFileName(`${parts.join("_")}.pdf`);
}

/* ==========================================================
   ZIP paths, CSV, and downloads
   ========================================================== */

function createUniquePath(preferredPath, usedPaths) {
  const normalized = normalizePath(preferredPath);
  const lowerCasePath = normalized.toLowerCase();

  if (!usedPaths.has(lowerCasePath)) {
    usedPaths.add(lowerCasePath);
    return normalized;
  }

  const slashIndex = normalized.lastIndexOf("/");
  const folder = slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";

  let counter = 2;

  while (true) {
    const candidate = `${folder}${baseName}_${counter}${extension}`;
    const candidateKey = candidate.toLowerCase();

    if (!usedPaths.has(candidateKey)) {
      usedPaths.add(candidateKey);
      return candidate;
    }

    counter += 1;
  }
}

function createAuditCsv(rows) {
  const columns = [
    "source_type",
    "source_name",
    "dated_folder",
    "original_path",
    "original_name",
    "document_type",
    "period_start",
    "period_end",
    "unit",
    "output_name",
    "structured_path",
    "flat_path",
    "status",
    "error"
  ];

  const lines = [columns.map(csvEscape).join(",")];

  rows.forEach((row) => {
    lines.push(columns.map((column) => csvEscape(row[column] || "")).join(","));
  });

  return lines.join("\r\n");
}

function csvEscape(value) {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function createDownloadFileName() {
  const now = new Date();
  const stamp =
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0") +
    "_" +
    String(now.getHours()).padStart(2, "0") +
    String(now.getMinutes()).padStart(2, "0");

  return `GST_FUEL_STATEMENT_Results_${stamp}.zip`;
}

function downloadGeneratedZip() {
  if (!generatedZipBlob) {
    return;
  }

  const objectUrl = URL.createObjectURL(generatedZipBlob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = generatedZipName || "GST_FUEL_STATEMENT_Results.zip";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

/* ==========================================================
   General helpers and interface state
   ========================================================== */

function getDocumentType(fileName) {
  const match = fileName.match(/_(FUEL|STATEMENT)\.pdf$/i);
  return match ? match[1].toUpperCase() : "";
}

function findDatedFolder(relativePath) {
  const parts = normalizePath(relativePath).split("/");

  for (let index = parts.length - 2; index >= 0; index -= 1) {
    if (/^\d{8}$/.test(parts[index])) {
      return parts[index];
    }
  }

  return "";
}

function normalizePath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function sanitizeNamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sanitizeFileName(fileName) {
  return String(fileName || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 180);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

function setOverallStatus(type, message) {
  elements.overallStatus.className = `status-callout ${type}`;
  elements.overallStatus.textContent = message;
}

function setProgress(value, text) {
  elements.progressBar.value = Math.min(100, Math.max(0, value));
  elements.progressText.textContent = text;
}

function setBusyState(isBusy, progressText) {
  elements.folderInput.disabled = isBusy;
  elements.zipInput.disabled = isBusy;
  elements.monthsInput.disabled = isBusy;
  elements.structuredOption.disabled = isBusy;
  elements.flatOption.disabled = isBusy;
  elements.renameOption.disabled = isBusy;
  elements.auditOption.disabled = isBusy;
  elements.resetButton.disabled = isBusy;
  elements.processButton.disabled =
    isBusy || analyzeEntries(selectedEntries).matchingEntries.length === 0;

  if (progressText) {
    elements.progressText.textContent = progressText;
  }
}

function clearGeneratedOutput() {
  generatedZipBlob = null;
  generatedZipName = "";
  elements.downloadButton.disabled = true;
  setProgress(0, "Ready");
}

function showApplicationError(message) {
  setOverallStatus("error", message);
  elements.errorCount.textContent = "1";
  elements.progressText.textContent = "Error";
}

function addLog(message) {
  const timestamp = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  logLines.push(`[${timestamp}] ${message}`);
  elements.processingLog.textContent = logLines.join("\n");
}

function resetApplication() {
  selectedEntries = [];
  selectedSource = null;
  generatedZipBlob = null;
  generatedZipName = "";
  logLines = [];

  elements.folderInput.value = "";
  elements.zipInput.value = "";
  elements.monthsInput.value = "3";
  elements.structuredOption.checked = true;
  elements.flatOption.checked = true;
  elements.renameOption.checked = true;
  elements.auditOption.checked = true;
  elements.processingLog.textContent = "Ready.";
  elements.selectionSummary.textContent = "No folder or ZIP file selected.";

  clearGeneratedOutput();
  renderValidation(analyzeEntries([]), 0);
  elements.processButton.disabled = true;
}

resetApplication();

"use strict";

const PDFJS_VERSION = "3.11.174";
const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;

if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
}

const elements = {
  folderInput: document.getElementById("folderInput"),
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

let selectedFiles = [];
let generatedZipBlob = null;
let generatedZipName = "";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function log(message) {
  const timestamp = new Date().toLocaleTimeString([], { hour12: false });
  const current = elements.processingLog.textContent === "Ready." ? "" : elements.processingLog.textContent;
  elements.processingLog.textContent = `${current}[${timestamp}] ${message}\n`;
  elements.processingLog.scrollTop = elements.processingLog.scrollHeight;
}

function setProgress(current, total, message) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  elements.progressBar.value = percent;
  elements.progressText.textContent = message || `${percent}%`;
}

function setOverallStatus(kind, message) {
  elements.overallStatus.className = `status-callout ${kind}`;
  elements.overallStatus.textContent = message;
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
  const parts = relativePath.split("/").filter(Boolean);

  // A browser folder selection includes the selected root folder as the
  // first path segment. Process only PDFs directly inside an immediate
  // dated subfolder, matching the PowerShell version.
  const relativeParts = parts.length > 1 ? parts.slice(1) : parts;

  if (relativeParts.length !== 2) {
    return null;
  }

  return isValidDateFolderName(relativeParts[0])
    ? relativeParts[0]
    : null;
}

function getDocumentType(fileName) {
  const baseName = fileName.replace(/\.pdf$/i, "");
  const match = baseName.match(/_(FUEL|STATEMENT)$/i);
  return match ? match[1].toUpperCase() : null;
}

function parseDocumentDate(dateText) {
  const match = String(dateText).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
}

function compareDocumentDates(a, b) {
  return (a.year - b.year) || (a.month - b.month) || (a.day - b.day);
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
    throw new Error("PDF.js did not load. Check your internet connection and reload the page.");
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
        return { startDate, endDate, method: "Fuel period text" };
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
      return { startDate, endDate, method: "Statement period labels" };
    }

    const uniqueDates = [...text.matchAll(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g)]
      .map(match => parseDocumentDate(match[0]))
      .filter(Boolean)
      .sort(compareDocumentDates)
      .filter((date, index, array) => index === 0 || dateKey(date) !== dateKey(array[index - 1]));

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
  const fileMatch = fileName.match(/^\d{8}_(\d+)_/);
  if (fileMatch) return fileMatch[1];

  const textMatch = text.match(/UNIT\s*#?\s*:\s*(\d+)/i);
  return textMatch ? textMatch[1] : "UNKNOWN";
}

function buildRenamedFileName(period, unitNumber, documentType) {
  const end = period.endDate;
  const yearMonth = `${String(end.year).padStart(4, "0")}-${String(end.month).padStart(2, "0")}`;
  const monthName = MONTH_NAMES[end.month - 1];
  const periodRange = `${String(period.startDate.day).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`;
  return `${yearMonth}_${monthName}_${periodRange}_${unitNumber}_${documentType}.pdf`;
}

function escapeCsv(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildAuditCsv(rows) {
  const headers = [
    "Source Folder", "Original File", "Output File", "Document Type",
    "Period Start", "Period End", "Unit", "Detection Method", "Status", "Message"
  ];

  const csvRows = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    csvRows.push([
      row.sourceFolder,
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
  const normalized = basePath.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  if (!usedPaths.has(lower)) {
    usedPaths.add(lower);
    return normalized;
  }

  const slashIndex = normalized.lastIndexOf("/");
  const directory = slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "";
  const fileName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const extensionIndex = fileName.toLowerCase().lastIndexOf(".pdf");
  const baseName = extensionIndex >= 0 ? fileName.slice(0, extensionIndex) : fileName;
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex) : "";
  const safeFolder = sourceFolder || "duplicate";

  let counter = 1;
  let candidate;
  do {
    const suffix = counter === 1 ? `_${safeFolder}` : `_${safeFolder}_${counter}`;
    candidate = `${directory}${baseName}${suffix}${extension}`;
    counter += 1;
  } while (usedPaths.has(candidate.toLowerCase()));

  usedPaths.add(candidate.toLowerCase());
  return candidate;
}

function renderFolderValidation(folderMap) {
  const entries = [...folderMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  elements.folderResultsBody.innerHTML = "";

  if (entries.length === 0) {
    elements.folderResultsBody.innerHTML = '<tr><td colspan="5" class="empty-state">No dated folders found.</td></tr>';
    return 0;
  }

  let issueCount = 0;

  for (const [folderName, counts] of entries) {
    const passed = counts.FUEL === 1 && counts.STATEMENT === 1;
    if (!passed) issueCount += 1;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${folderName}</td>
      <td>${counts.FUEL}</td>
      <td>${counts.STATEMENT}</td>
      <td>${counts.total}</td>
      <td class="status-text ${passed ? "success" : "warning"}">${passed ? "Passed" : "Check files"}</td>
    `;
    elements.folderResultsBody.appendChild(row);
  }

  return issueCount;
}

function resetResults() {
  generatedZipBlob = null;
  generatedZipName = "";
  elements.downloadButton.disabled = true;
  elements.folderCount.textContent = "0";
  elements.pdfCount.textContent = "0";
  elements.issueCount.textContent = "0";
  elements.errorCount.textContent = "0";
  elements.folderResultsBody.innerHTML = '<tr><td colspan="5" class="empty-state">No results yet.</td></tr>';
  elements.processingLog.textContent = "Ready.";
  elements.progressBar.value = 0;
  elements.progressText.textContent = "Ready";
  setOverallStatus("neutral", "Select a folder to begin.");
}

function resetApplication() {
  elements.folderInput.value = "";
  selectedFiles = [];
  elements.selectionSummary.textContent = "No folder selected.";
  elements.processButton.disabled = true;
  resetResults();
}

function browserRequirementsLoaded() {
  return Boolean(window.pdfjsLib && window.JSZip);
}

async function processSelectedFiles() {
  if (!selectedFiles.length) {
    setOverallStatus("warning", "Choose the GST parent folder first.");
    return;
  }

  if (!elements.structuredOption.checked && !elements.flatOption.checked) {
    setOverallStatus("warning", "Select at least one output folder option.");
    return;
  }

  if (!browserRequirementsLoaded()) {
    setOverallStatus("error", "Required browser libraries did not load. Check your internet connection and reload the page.");
    return;
  }

  const expectedMonths = Number(elements.monthsInput.value);
  if (!Number.isInteger(expectedMonths) || expectedMonths < 1) {
    setOverallStatus("warning", "Enter a valid number of months.");
    return;
  }

  resetResults();
  elements.processButton.disabled = true;
  elements.resetButton.disabled = true;
  elements.folderInput.disabled = true;
  setOverallStatus("neutral", "Processing files...");

  const zip = new window.JSZip();
  const usedZipPaths = new Set();
  const folderMap = new Map();
  const auditRows = [];
  let matchingCount = 0;
  let processingErrors = 0;

  const selectedPdfFiles = selectedFiles.filter(file => file.name.toLowerCase().endsWith(".pdf"));
  const totalFilesToReview = selectedPdfFiles.length;

  log(`Selected ${selectedFiles.length} files, including ${selectedPdfFiles.length} PDFs.`);

  for (let index = 0; index < selectedPdfFiles.length; index += 1) {
    const file = selectedPdfFiles[index];
    const relativePath = file.webkitRelativePath || file.name;
    const sourceFolder = getDatedFolder(relativePath);
    const documentType = getDocumentType(file.name);

    setProgress(index, Math.max(totalFilesToReview, 1), `Reviewing ${index + 1} of ${totalFilesToReview}: ${file.name}`);

    if (!sourceFolder || !documentType) {
      continue;
    }

    matchingCount += 1;

    if (!folderMap.has(sourceFolder)) {
      folderMap.set(sourceFolder, { FUEL: 0, STATEMENT: 0, total: 0 });
    }
    const counts = folderMap.get(sourceFolder);
    counts[documentType] += 1;
    counts.total += 1;

    let outputFileName = file.name;
    let period = null;
    let unitNumber = "";
    let detectionMethod = "Not requested";

    try {
      let text = "";

      if (elements.renameOption.checked) {
        const originalBytes = new Uint8Array(await file.arrayBuffer());
        text = await extractPdfText(originalBytes);
        period = getDocumentPeriod(text, documentType);

        if (!period) {
          throw new Error("Period start and end dates were not detected.");
        }

        if (compareDocumentDates(period.startDate, period.endDate) > 0) {
          throw new Error("Detected period start is after period end.");
        }

        unitNumber = getUnitNumber(file.name, text);
        detectionMethod = period.method;
        outputFileName = buildRenamedFileName(period, unitNumber, documentType);
      }

      // Keep the complete original PDF. The application only changes the
      // filename and output folder structure when those options are selected.
      const outputData = file;

      if (elements.structuredOption.checked) {
        const structuredPath = makeUniqueZipPath(
          `Extracted_FUEL_STATEMENT/${sourceFolder}/${outputFileName}`,
          usedZipPaths,
          sourceFolder
        );
        zip.file(structuredPath, outputData);
      }

      if (elements.flatOption.checked) {
        const flatPath = makeUniqueZipPath(
          `Extracted_FUEL_STATEMENT_FLAT/${outputFileName}`,
          usedZipPaths,
          sourceFolder
        );
        zip.file(flatPath, outputData);
      }

      auditRows.push({
        sourceFolder,
        originalFile: file.name,
        outputFile: outputFileName,
        documentType,
        periodStart: period ? dateKey(period.startDate) : "",
        periodEnd: period ? dateKey(period.endDate) : "",
        unitNumber,
        detectionMethod,
        status: "Processed",
        message: ""
      });

      log(`Processed ${sourceFolder}/${file.name} -> ${outputFileName}`);
    } catch (error) {
      processingErrors += 1;
      const message = error instanceof Error ? error.message : String(error);
      auditRows.push({
        sourceFolder,
        originalFile: file.name,
        outputFile: "",
        documentType,
        periodStart: "",
        periodEnd: "",
        unitNumber: "",
        detectionMethod: "",
        status: "Error",
        message
      });
      log(`ERROR ${sourceFolder}/${file.name}: ${message}`);
    }
  }

  const folderIssueCount = renderFolderValidation(folderMap);
  const datedFolderCount = folderMap.size;
  const expectedFolderCount = expectedMonths * 2;
  const expectedPdfCount = expectedMonths * 4;

  elements.folderCount.textContent = String(datedFolderCount);
  elements.pdfCount.textContent = String(matchingCount);
  elements.issueCount.textContent = String(folderIssueCount);
  elements.errorCount.textContent = String(processingErrors);

  if (elements.auditOption.checked) {
    zip.file("GST_FUEL_STATEMENT_Audit_Log.csv", buildAuditCsv(auditRows));
  }

  const countChecksPassed = datedFolderCount === expectedFolderCount && matchingCount === expectedPdfCount;
  const allChecksPassed = countChecksPassed && folderIssueCount === 0 && processingErrors === 0;

  log(`Expected ${expectedFolderCount} dated folders and ${expectedPdfCount} matching PDFs.`);
  log(`Found ${datedFolderCount} dated folders and ${matchingCount} matching PDFs.`);

  if (allChecksPassed) {
    setOverallStatus("success", `Passed: found ${datedFolderCount} dated folders and ${matchingCount} matching PDFs, with 1 FUEL and 1 STATEMENT in every folder.`);
  } else {
    const messages = [];
    if (datedFolderCount !== expectedFolderCount) {
      messages.push(`found ${datedFolderCount} dated folders; expected ${expectedFolderCount}`);
    }
    if (matchingCount !== expectedPdfCount) {
      messages.push(`found ${matchingCount} matching PDFs; expected ${expectedPdfCount}`);
    }
    if (folderIssueCount > 0) {
      messages.push(`${folderIssueCount} folder(s) do not have exactly 1 FUEL and 1 STATEMENT`);
    }
    if (processingErrors > 0) {
      messages.push(`${processingErrors} PDF processing error(s)`);
    }
    setOverallStatus("warning", `Review needed: ${messages.join("; ")}.`);
  }

  try {
    setProgress(totalFilesToReview, Math.max(totalFilesToReview, 1), "Building ZIP file...");
    generatedZipBlob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
      metadata => {
        elements.progressBar.value = metadata.percent;
        elements.progressText.textContent = `Building ZIP: ${Math.round(metadata.percent)}%`;
      }
    );

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "_").slice(0, 15);
    generatedZipName = `GST_FUEL_STATEMENT_${stamp}.zip`;
    elements.downloadButton.disabled = matchingCount === 0;
    setProgress(1, 1, matchingCount > 0 ? "Ready to download" : "No matching files found");
  } catch (error) {
    processingErrors += 1;
    elements.errorCount.textContent = String(processingErrors);
    const message = error instanceof Error ? error.message : String(error);
    setOverallStatus("error", `Could not build the ZIP file: ${message}`);
    log(`ERROR building ZIP: ${message}`);
  } finally {
    elements.processButton.disabled = false;
    elements.resetButton.disabled = false;
    elements.folderInput.disabled = false;
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
  URL.revokeObjectURL(url);
}

elements.pennerLogo.addEventListener("error", () => {
  elements.pennerLogo.style.display = "none";
  elements.logoFallback.style.display = "grid";
});

elements.pennerLogo.addEventListener("load", () => {
  elements.logoFallback.style.display = "none";
  elements.pennerLogo.style.display = "block";
});

elements.folderInput.addEventListener("change", event => {
  selectedFiles = Array.from(event.target.files || []);
  generatedZipBlob = null;
  generatedZipName = "";
  elements.downloadButton.disabled = true;

  if (!selectedFiles.length) {
    elements.selectionSummary.textContent = "No folder selected.";
    elements.processButton.disabled = true;
    return;
  }

  const pdfFiles = selectedFiles.filter(file => file.name.toLowerCase().endsWith(".pdf"));
  const datedFolders = new Set(
    selectedFiles
      .map(file => getDatedFolder(file.webkitRelativePath || file.name))
      .filter(Boolean)
  );

  const topFolder = (selectedFiles[0].webkitRelativePath || "Selected folder").split("/")[0];
  elements.selectionSummary.textContent = `${topFolder}: ${selectedFiles.length} total files, ${pdfFiles.length} PDFs, ${datedFolders.size} dated folders.`;
  elements.processButton.disabled = false;
  resetResults();
});

elements.processButton.addEventListener("click", processSelectedFiles);
elements.downloadButton.addEventListener("click", downloadGeneratedZip);
elements.resetButton.addEventListener("click", resetApplication);

if (!browserRequirementsLoaded()) {
  setOverallStatus("warning", "Loading browser libraries. If this message remains, check your internet connection and reload the page.");
}

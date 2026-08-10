# GST FUEL and STATEMENT File Extractor

**Version 5 – Folder/ZIP input, drag-and-drop, pay-period detection, and rename preview**

A browser-based utility for extracting, validating, renaming, and organizing Penner International GST FUEL and STATEMENT PDF files.

Created by **Charanpal Singh**.

## Purpose

This application helps organize downloaded GST documents by finding PDF files that end exactly in:

- `_FUEL.pdf`
- `_STATEMENT.pdf`

The app reads the selected PDFs in the browser, detects their pay-period dates, validates expected FUEL/STATEMENT pairs, previews the proposed renamed filenames, and creates a downloadable ZIP containing structured and/or flat output folders.

The complete original PDF contents are preserved. The app changes the output filename and folder structure only; it does not remove or rebuild PDF pages.

## Version 5 Highlights

- Select a normal GST parent folder
- Select a GST ZIP file
- Drag and drop a GST folder or ZIP file
- Automatically read pay-period dates from the PDFs
- Automatically determine the expected month range
- Detect missing, incomplete, duplicate, and non-standard pay periods
- Preview proposed filenames before creating the output ZIP
- Validate each 8-digit dated folder
- Create structured and/or flat output folders
- Include an optional CSV audit log
- Prevent duplicate output filenames from silently overwriting one another
- Process the selected documents locally in the browser

## Supported Input Methods

### Folder selection

Use **Choose GST parent folder** and select the folder containing the dated GST folders.

### ZIP selection

Use **Choose GST ZIP file** and select a ZIP containing the GST folders.

The ZIP may contain an additional outer folder. A matching PDF is processed when its immediate parent folder is a valid 8-digit date folder.

### Drag and drop

A GST folder or ZIP file can also be dragged onto the drop area.

Folder drag-and-drop support depends on the browser. If the browser cannot read a dropped folder, use **Choose GST parent folder** instead.

## Expected Input Structure

A typical source folder or ZIP looks like:

```text
GST Folder
├── 20260415
│   ├── 20260415_70161_FUEL.pdf
│   ├── 20260415_70161_STATEMENT.pdf
│   ├── 20260415_70161_FUELTAX.pdf
│   └── 20260415_70161_REPAIRS.pdf
├── 20260430
│   ├── 20260430_70161_FUEL.pdf
│   └── 20260430_70161_STATEMENT.pdf
├── 20260515
│   ├── 20260515_70161_FUEL.pdf
│   └── 20260515_70161_STATEMENT.pdf
└── 20260531
    ├── 20260531_70161_FUEL.pdf
    └── 20260531_70161_STATEMENT.pdf
```

Only files ending exactly in `_FUEL.pdf` or `_STATEMENT.pdf` are treated as matching documents.

Files such as these are intentionally ignored:

```text
_FUELTAX.pdf
_REPAIRS.pdf
_LEGS.pdf
```

## Dated Folder Rules

The immediate parent folder of a matching PDF must:

- Contain exactly 8 digits
- Use `YYYYMMDD` format
- Represent a valid calendar date

Examples:

```text
20260415  ✓ valid
20260430  ✓ valid
20260431  ✗ invalid date
2026-04-30  ✗ incorrect folder format
```

Matching FUEL or STATEMENT PDFs found outside a valid dated folder are not processed. Their paths are written to `Matching_PDFs_Outside_Dated_Folders.txt` when an output ZIP is created.

## Automatic Pay-Period Detection

After a folder or ZIP is selected, the application automatically reads the matching PDFs using PDF.js.

### FUEL PDFs

The app looks for period text in the PDF in the form:

```text
For the Period from YYYY-MM-DD to YYYY-MM-DD
```

### STATEMENT PDFs

The app first looks for labelled dates such as:

```text
Period Start: YYYY-MM-DD
Period End: YYYY-MM-DD
```

If those labels are not detected, the app falls back to the first two unique chronological dates found in the STATEMENT PDF.

## Unit Number Detection

The unit number is taken from the original filename first.

For example:

```text
20260430_70161_FUEL.pdf
```

produces unit:

```text
70161
```

If a numeric unit cannot be found in the filename, the app attempts to read a labelled unit number from the PDF text.

## Automatic Month Detection

The app determines the month range from the successfully detected PDF pay periods.

For example, if PDFs are detected from April through June 2026, the application automatically sets:

```text
Detected months: 3
Expected dated folders: 6
Expected matching PDFs: 12
Expected pay periods: 6
```

The **Number of months expected** field is updated automatically after PDF analysis. It can still be manually overridden.

## Expected Pay Periods

Version 5 assumes two standard pay periods per month:

```text
1st through 15th
16th through the final day of the month
```

Examples:

```text
April 2026
├── Apr 01–15
└── Apr 16–30

May 2026
├── May 01–15
└── May 16–31
```

February automatically uses its actual final calendar day.

## Missing-Period Detection

The **Detected pay periods** section compares the PDF periods found with the expected periods across the detected month range.

Possible statuses include:

- `Complete`
- `Missing period`
- `Missing FUEL`
- `Missing STATEMENT`
- `Duplicate files`
- `Non-standard period`

For example:

```text
Expected pay period    FUEL        STATEMENT      Status
Apr 01–15, 2026        Found (1)   Found (1)      Complete
Apr 16–30, 2026        Found (1)   Missing        Missing STATEMENT
May 01–15, 2026        Found (1)   Found (1)      Complete
May 16–31, 2026        Missing     Missing        Missing period
```

This is more informative than checking only the total number of files.

## Rename Preview

After PDF analysis, the app shows a preview containing:

- Dated folder
- Original filename
- Detected pay period
- Unit number
- Proposed output filename
- Analysis status

The output naming format is:

```text
YYYY-MM_Month_DD-DD_UNIT_DOCUMENTTYPE.pdf
```

Example:

```text
Original:
20260430_70161_FUEL.pdf

Proposed:
2026-04_April_16-30_70161_FUEL.pdf
```

A matching STATEMENT could become:

```text
2026-04_April_16-30_70161_STATEMENT.pdf
```

If the period cannot be reliably detected, the preview reports an error instead of silently inventing a renamed filename.

## Folder-Level Validation

For each valid dated folder, the app counts:

- FUEL files
- STATEMENT files
- Total matching PDFs

A folder passes when it contains exactly:

```text
1 FUEL
1 STATEMENT
2 matching PDFs total
```

The overall validation also compares the actual totals with the expected values:

```text
Expected dated folders = months × 2
Expected matching PDFs = months × 4
```

## Processing Options

### Structured output with dated subfolders

Creates output such as:

```text
Extracted_FUEL_STATEMENT
├── 20260415
│   ├── 2026-04_April_01-15_70161_FUEL.pdf
│   └── 2026-04_April_01-15_70161_STATEMENT.pdf
└── 20260430
    ├── 2026-04_April_16-30_70161_FUEL.pdf
    └── 2026-04_April_16-30_70161_STATEMENT.pdf
```

### Flat output without subfolders

Creates output such as:

```text
Extracted_FUEL_STATEMENT_FLAT
├── 2026-04_April_01-15_70161_FUEL.pdf
├── 2026-04_April_01-15_70161_STATEMENT.pdf
├── 2026-04_April_16-30_70161_FUEL.pdf
└── 2026-04_April_16-30_70161_STATEMENT.pdf
```

Both output options can be selected at the same time.

## Duplicate Filename Protection

The application keeps track of output paths so that duplicate filenames are not silently overwritten.

If a duplicate output name is detected, the dated source folder is added to the filename. Additional duplicates receive a numeric suffix.

## CSV Audit Log

When **Include CSV audit log** is enabled, the output ZIP contains:

```text
GST_FUEL_STATEMENT_Audit_Log.csv
```

The audit log includes:

- Source type
- Source name
- Source folder
- Original path
- Original filename
- Output filename
- Document type
- Period start
- Period end
- Unit number
- Detection method
- Processing status
- Error message

This makes it easier to review what was processed and how each renamed filename was determined.

## Output ZIP

After validation and preview are complete, click **Create output ZIP**.

When processing finishes, click **Download results ZIP**.

The generated ZIP is named using the current timestamp, for example:

```text
GST_FUEL_STATEMENT_20260808_184500.zip
```

Depending on the selected options and validation results, it can contain:

```text
GST_FUEL_STATEMENT_20260808_184500.zip
├── Extracted_FUEL_STATEMENT/
├── Extracted_FUEL_STATEMENT_FLAT/
├── GST_FUEL_STATEMENT_Audit_Log.csv
└── Matching_PDFs_Outside_Dated_Folders.txt   # only when needed
```

The output ZIP is still created when some files require review. Files that fail processing are reported rather than silently included under an invented renamed filename.

## How to Use

1. Open the web application.
2. Download the required GST documents from Penner ShareFile.
3. Select a GST parent folder, select a GST ZIP file, or drag and drop a folder/ZIP onto the page.
4. Wait for the automatic PDF analysis to finish.
5. Review **Detected pay periods**.
6. Review **Rename preview**.
7. Confirm or manually adjust the expected number of months if necessary.
8. Choose structured output, flat output, or both.
9. Leave **Rename using period dates, unit, and document type** enabled to use the proposed filenames.
10. Leave **Include CSV audit log** enabled if an audit file is required.
11. Click **Create output ZIP**.
12. Review the final validation status.
13. Click **Download results ZIP**.

## Privacy

The selected PDFs and ZIP files are processed locally in the user's web browser.

The application does not intentionally upload the selected documents to:

- GitHub
- Penner International
- The application developer
- A separate document-processing server

The webpage currently loads PDF.js and JSZip from jsDelivr. This means an internet connection is required to load those external JavaScript libraries unless they are later hosted locally with the project.

## Technology

The application uses:

- HTML
- CSS
- JavaScript
- PDF.js for reading PDF text
- JSZip for reading input ZIP files and creating output ZIP files

No PowerShell installation or Python installation is required for the browser version.

## Repository Structure

```text
GST-File-Extractor
├── index.html
├── styles.css
├── app.js
├── Penner_Logo.png
├── README.md
└── .nojekyll        # optional for GitHub Pages
```

## Running the App

### GitHub Pages

The project can be hosted as a static GitHub Pages site because it uses browser-side HTML, CSS, and JavaScript.

### Local use

Open:

```text
index.html
```

in a browser.

Do not open `app.js` directly. It is loaded automatically by `index.html`.

Because PDF.js and JSZip are currently loaded from a CDN, the browser needs internet access to retrieve those libraries.

## Browser Notes

The normal folder picker uses browser directory-selection functionality, and folder drag-and-drop uses browser file-system entry support. These capabilities can vary by browser and version.

If drag-and-drop does not work, use **Choose GST parent folder** or **Choose GST ZIP file**.

The responsive CSS adapts the interface for smaller screens, while wide result tables remain horizontally scrollable when needed.

## Troubleshooting

### No folder or ZIP file selected

Confirm that a folder or ZIP was actually selected and wait for the source to finish loading.

### No dated folders are found

Confirm that matching PDFs are directly inside valid 8-digit folders such as:

```text
20260430
```

### No matching PDFs are found

Confirm that the desired filenames end exactly in:

```text
_FUEL.pdf
_STATEMENT.pdf
```

Files such as `_FUELTAX.pdf` are intentionally excluded.

### PDF analysis error

The app could not reliably determine the required dates or other rename information from that PDF. Review the **Rename preview** and processing log.

### Missing period is reported

The app expects two periods per detected month:

```text
1–15
16–end of month
```

Confirm whether the corresponding FUEL and STATEMENT PDFs were downloaded.

### ZIP cannot be read

Confirm that the selected file is a readable ZIP file and that JSZip loaded successfully.

### Drag-and-drop folder does not work

Use **Choose GST parent folder**. The app includes this fallback because browser support for dropped directories can vary.

### Output ZIP cannot be created

Confirm that:

- At least one output option is selected
- Matching PDFs were found
- Automatic preview analysis has finished
- JavaScript is enabled
- PDF.js and JSZip loaded successfully

## Disclaimer

This is an independent file-processing utility and is not an official Penner International application.

The Penner name and logo remain the property of their respective owner(s) and should only be used or distributed with appropriate permission.

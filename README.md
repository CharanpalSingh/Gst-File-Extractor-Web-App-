# GST FUEL and STATEMENT File Extractor

A browser-based tool for extracting, validating, renaming, and organizing Penner International GST documents from either a local folder or a ZIP file.

Created by **Charanpal Singh**.

## Purpose

This application searches a selected GST parent folder or ZIP file for PDF files ending exactly in:

- `_FUEL.pdf`
- `_STATEMENT.pdf`

It validates the expected files, optionally renames them using information found in the PDFs, and creates a downloadable ZIP containing structured and/or flat output folders.

The complete original PDFs are preserved. Pages are not removed or modified.

## Features

- Runs directly in a web browser
- No PowerShell or software installation required
- Accepts either:
  - An entire local GST parent folder
  - A standard GST ZIP file
- Supports ZIP files that contain an additional outer folder
- Recognizes dated folders named in `YYYYMMDD` format
- Finds files ending exactly in `_FUEL.pdf` or `_STATEMENT.pdf`
- Ignores files such as:
  - `_FUELTAX.pdf`
  - `_REPAIRS.pdf`
  - `_LEGS.pdf`
- Checks for one FUEL and one STATEMENT file in each dated folder
- Checks the expected folder and file totals based on the number of months
- Optionally renames files using the period dates, unit, and document type
- Uses fallback filenames when PDF metadata cannot be read
- Creates structured and/or flat output folders
- Prevents duplicate filenames from being silently overwritten
- Optionally creates a CSV audit log
- Reports matching PDFs found outside an 8-digit dated folder
- Downloads all results as one ZIP file
- Processes selected files locally in the browser
- Keeps the complete original PDFs unchanged

## Get the Statements

Statements can be downloaded from:

[Penner International ShareFile](https://pennerinternational.sharefile.com/)

After downloading the statements, either:

- Extract them and select the main GST parent folder, or
- Select the downloaded ZIP file directly

## Supported Input Methods

### Option 1: Select a GST Parent Folder

The selected parent folder should contain dated subfolders such as:

```text
GST Folder
├── 20260430
│   ├── 20260430_70161_FUEL.pdf
│   ├── 20260430_70161_STATEMENT.pdf
│   ├── 20260430_70161_FUELTAX_Syn12819.pdf
│   └── 20260430_70161_REPAIRS_Syn12879.pdf
├── 20260515
│   ├── 20260515_70161_FUEL.pdf
│   └── 20260515_70161_STATEMENT.pdf
└── 20260529
    ├── 20260529_70161_FUEL.pdf
    └── 20260529_70161_STATEMENT.pdf
```

### Option 2: Select a GST ZIP File

The ZIP may contain the dated folders directly:

```text
GST_Statements.zip
├── 20260430
│   ├── 20260430_70161_FUEL.pdf
│   └── 20260430_70161_STATEMENT.pdf
└── 20260515
    ├── 20260515_70161_FUEL.pdf
    └── 20260515_70161_STATEMENT.pdf
```

It may also contain an additional outer folder:

```text
GST_Statements.zip
└── GST Folder
    ├── 20260430
    │   ├── 20260430_70161_FUEL.pdf
    │   └── 20260430_70161_STATEMENT.pdf
    └── 20260515
        ├── 20260515_70161_FUEL.pdf
        └── 20260515_70161_STATEMENT.pdf
```

Only PDFs located inside an 8-digit dated folder are processed.

Only files ending exactly in `_FUEL.pdf` and `_STATEMENT.pdf` are treated as matching documents.

## Expected Counts

There are normally:

- 2 dated folders per month
- 2 matching PDFs per dated folder
- 4 matching PDFs per month

| Months | Dated folders | Matching PDFs |
|---:|---:|---:|
| 3 | 6 | 12 |
| 6 | 12 | 24 |
| 12 | 24 | 48 |

The application displays a warning when the actual counts do not match the expected totals.

## How to Use

1. Open the web application.
2. Download the required statements from Penner ShareFile.
3. Choose one input method:
   - Select the main folder containing the dated folders, or
   - Select a GST ZIP file
4. Enter the number of months being processed.
5. Choose one or both output options:
   - Structured output with dated subfolders
   - Flat output without subfolders
6. Choose whether to:
   - Rename PDFs using period dates, unit, and document type
   - Include a CSV audit log
7. Click **Process selected source**.
8. Review the folder-level validation results and processing log.
9. Click **Download results ZIP**.

Selecting a folder clears any previously selected ZIP file. Selecting a ZIP file clears any previously selected folder.

## Output Options

### Structured Output

Preserves the dated folder structure:

```text
Extracted_FUEL_STATEMENT
├── 20260430
│   ├── 20260401_20260415_Unit_70161_FUEL.pdf
│   └── 20260401_20260415_Unit_70161_STATEMENT.pdf
├── 20260515
│   ├── 20260416_20260430_Unit_70161_FUEL.pdf
│   └── 20260416_20260430_Unit_70161_STATEMENT.pdf
└── ...
```

### Flat Output

Places all matching PDFs into one folder:

```text
Extracted_FUEL_STATEMENT_FLAT
├── 20260401_20260415_Unit_70161_FUEL.pdf
├── 20260401_20260415_Unit_70161_STATEMENT.pdf
├── 20260416_20260430_Unit_70161_FUEL.pdf
├── 20260416_20260430_Unit_70161_STATEMENT.pdf
└── ...
```

If duplicate output paths are found, the application adds a number to the filename to prevent overwriting.

## Optional PDF Renaming

When the renaming option is enabled, the application attempts to read each PDF and create a filename using:

- Period start date
- Period end date
- Unit number
- Document type

Example:

```text
20260401_20260415_Unit_70161_FUEL.pdf
```

When period dates cannot be read, the application uses available filename information and the dated folder to create a fallback filename. The PDF content itself is not altered.

## CSV Audit Log

When the audit-log option is enabled, the output ZIP includes:

```text
GST_File_Extractor_Audit.csv
```

The audit log records information such as:

- Input source type and name
- Dated folder
- Original path and filename
- Document type
- Extracted period dates
- Unit number
- Output filename and paths
- Processing status
- Error details, when applicable

## Validation Checks

For each dated folder, the application checks:

- FUEL file count
- STATEMENT file count
- Total matching file count
- Whether exactly one FUEL and one STATEMENT file are present

It also checks:

- Total number of dated folders
- Total number of matching PDFs
- Expected totals based on the selected number of months
- Matching PDFs located outside an 8-digit dated folder
- PDF-processing errors

Matching PDFs outside dated folders are not processed. When any are found, the output ZIP includes:

```text
Matching_PDFs_Outside_Dated_Folders.txt
```

## Privacy

All selected folders, ZIP entries, and PDFs are processed locally in the user’s web browser.

The application does not upload the selected documents to:

- GitHub
- Penner International
- A third-party processing server
- The application developer

Only the website files are hosted online.

The application currently downloads the PDF.js and JSZip library code from jsDelivr when the webpage loads. Those libraries run in the browser; the selected PDFs are not sent to jsDelivr by the application.

## Technology

This application is written using:

- HTML
- CSS
- JavaScript
- PDF.js for reading text and metadata from PDFs
- JSZip for reading input ZIP files and creating the downloadable output ZIP

## Repository Structure

```text
Gst-File-Extractor-Web-App-
├── index.html
├── styles.css
├── app.js
├── Penner_Logo.png
├── README.md
└── .nojekyll
```

## Run Locally

Open:

```text
index.html
```

in a web browser.

Do not open `app.js` directly. It is loaded automatically by `index.html`.

Because PDF.js and JSZip are currently loaded from jsDelivr, an internet connection is required when the page first loads unless the libraries are hosted locally in the repository.

For development, open the project folder in Visual Studio Code and use the Microsoft **Live Preview** extension.

## Browser Support

A current version of Google Chrome or Microsoft Edge is recommended for the most consistent folder-selection experience.

The ZIP-file option is useful on devices or browsers where selecting an entire folder is unavailable or inconsistent.

The application may also work in other modern browsers that support the required file, ZIP, PDF, and download features. Large ZIP files or many large PDFs may process more slowly on phones and tablets because processing occurs in browser memory.

## ZIP File Notes

- Use a normal `.zip` file.
- Password-protected or encrypted ZIP files are not supported.
- The PDFs must be inside folders with an 8-digit name such as `20260430`.
- An additional outer folder inside the ZIP is allowed.
- ZIP entries that do not end exactly in `_FUEL.pdf` or `_STATEMENT.pdf` are ignored.

## Troubleshooting

### The JavaScript file opens in Windows Script Host

Do not double-click `app.js`.

Open `index.html` instead.

### No dated folders are found

Confirm that:

- The selected folder or ZIP contains folders named with exactly eight digits, such as `20260430`
- The matching PDFs are located somewhere inside those 8-digit folders

### No matching PDFs are found

Confirm that the filenames end exactly in:

```text
_FUEL.pdf
_STATEMENT.pdf
```

Files such as `_FUELTAX.pdf` are intentionally excluded.

### The input ZIP cannot be read

Confirm that:

- It is a normal `.zip` file
- It is not password-protected or encrypted
- The ZIP file is not damaged
- JavaScript is enabled
- The browser has internet access to load JSZip

### PDF renaming does not use the expected dates

The application searches the PDF text for recognizable period-start and period-end labels. Some PDFs may use a different layout or may not contain readable text.

The application will still create a fallback filename and record the available information in the audit log.

### The results ZIP download does not work

Confirm that:

- At least one output option is selected
- Matching PDFs were found
- JavaScript is enabled
- The browser allows downloads
- The browser has internet access to load PDF.js and JSZip

## Disclaimer

This is an independent file-processing utility and is not an official Penner International application.

The Penner logo should only be included and distributed with appropriate permission.

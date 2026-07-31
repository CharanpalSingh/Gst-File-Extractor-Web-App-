# GST FUEL and STATEMENT File Extractor

A browser-based tool for extracting, validating, and organizing Penner International GST documents.

Created by **Charanpal Singh**.

## Purpose

This application searches downloaded GST folders for PDF files ending exactly in:

- `_FUEL.pdf`
- `_STATEMENT.pdf`

It validates the expected files and creates a downloadable ZIP containing structured and/or flat output folders.

The complete original PDFs are preserved. Pages are not removed or modified.

## Features

- Runs directly in a web browser
- No PowerShell or software installation required
- Selects an entire local GST folder
- Recognizes dated folders named in `YYYYMMDD` format
- Finds files ending exactly in `_FUEL.pdf` or `_STATEMENT.pdf`
- Ignores files such as:
  - `_FUELTAX.pdf`
  - `_REPAIRS.pdf`
  - `_LEGS.pdf`
- Checks for one FUEL and one STATEMENT file in each dated folder
- Checks the expected folder and file totals based on the number of months
- Creates structured and/or flat output
- Prevents duplicate filenames from being silently overwritten
- Downloads the results as one ZIP file
- Processes all files locally in the browser
- Keeps the complete original PDFs unchanged

## Get the Statements

Statements can be downloaded from:

[Penner International ShareFile](https://pennerinternational.sharefile.com/)

Download and extract the required folders before using the application.

## Expected Input Structure

The selected GST folder should contain dated subfolders such as:

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

Only files ending exactly in `_FUEL.pdf` and `_STATEMENT.pdf` are processed.

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
3. Extract the downloaded files.
4. Select the main folder containing the dated folders.
5. Enter the number of months being processed.
6. Choose one or both output options:
   - Structured output with dated subfolders
   - Flat output without subfolders
7. Click **Process and validate**.
8. Review the folder-level validation results.
9. Click **Download output ZIP**.

## Output Options

### Structured Output

Preserves the dated folder structure:

```text
Extracted_FUEL_STATEMENT
├── 20260430
│   ├── 20260430_70161_FUEL.pdf
│   └── 20260430_70161_STATEMENT.pdf
├── 20260515
│   ├── 20260515_70161_FUEL.pdf
│   └── 20260515_70161_STATEMENT.pdf
└── 20260529
    ├── 20260529_70161_FUEL.pdf
    └── 20260529_70161_STATEMENT.pdf
```

### Flat Output

Places all matching PDFs into one folder:

```text
Extracted_FUEL_STATEMENT_FLAT
├── 20260430_70161_FUEL.pdf
├── 20260430_70161_STATEMENT.pdf
├── 20260515_70161_FUEL.pdf
├── 20260515_70161_STATEMENT.pdf
└── ...
```

If duplicate filenames are found, the application adds the original dated folder name to prevent overwriting.

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

## Privacy

All selected PDFs are processed locally in the user’s web browser.

The application does not upload the selected files to:

- GitHub
- Penner International
- A third-party server
- The application developer

Only the website files are hosted online.

## Technology

This application is written using:

- HTML
- CSS
- JavaScript
- JSZip for creating downloadable ZIP files

## Repository Structure

```text
GST-File-Extractor
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

For development, open the project folder in Visual Studio Code and use the Microsoft **Live Preview** extension.

## Browser Support

Google Chrome or Microsoft Edge is recommended because folder selection is most consistent in Chromium-based browsers.

The application may also work in other modern browsers that support directory selection.

## Troubleshooting

### The JavaScript file opens in Windows Script Host

Do not double-click `app.js`.

Open `index.html` instead.

### No dated folders are found

Confirm that:

- The selected folder contains immediate subfolders
- Folder names contain exactly eight digits
- Folder names represent valid dates, such as `20260430`

### No matching PDFs are found

Confirm that the filenames end exactly in:

```text
_FUEL.pdf
_STATEMENT.pdf
```

Files such as `_FUELTAX.pdf` are intentionally excluded.

### The logo does not appear

Confirm the image is named exactly:

```text
Penner_Logo.png
```

and is stored beside `index.html`.

### The ZIP download does not work

Confirm that:

- At least one output option is selected
- Matching PDFs were found
- JavaScript is enabled
- The browser has internet access to load JSZip

## Disclaimer

This is an independent file-processing utility and is not an official Penner International application.

The Penner logo should only be included and distributed with appropriate permission.

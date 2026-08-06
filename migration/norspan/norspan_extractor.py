#!/usr/bin/env python3
"""
BLC Nexus — Norspan Timesheet Extractor
----------------------------------------
Reads all Norspan invoice PDFs from a folder.
Outputs:
  - One clean CSV per PDF file
  - manifest.json  (file name, row count, total hours, checksum)
  - exceptions.json (rows needing human review)

Zero LLM involvement. Run locally before any Claude Code migration session.

Usage:
    python norspan_extractor.py --input /path/to/norspan/pdfs --output /path/to/output

Requirements:
    pip install pdfplumber
"""

import os
import re
import csv
import json
import hashlib
import argparse
from datetime import datetime
from pathlib import Path

import pdfplumber

# ─── CONFIGURATION ───────────────────────────────────────────────────────────

CLIENT_CODE = "NORSPAN-MB"

DESIGNER_MAP = {
    "RG-Ravi Gummadi":    "RKG",
    "RG-RaviKumar":       "RKG",
    "VK-Vani":            "VKV",
    "BC-Bharath Charles": "BCH",
    "SG-Sarty Ghosh":     "SGO",
    "SG-Sarty":           "SGO",
}

JOB_TYPE_MAP = {
    "Design-Quote": "DESIGNER",
    "Quality Check": "QC",
    "Others":        "QC",
}

# ─── DATE NORMALIZER ─────────────────────────────────────────────────────────

def normalize_date(raw):
    raw = raw.strip()
    parts = re.split(r"[-/]", raw)
    if len(parts) != 3:
        return "", f"Unrecognised date format: {raw!r}"
    a, b, c = parts
    try:
        if len(a) == 4:
            return datetime(int(a), int(b), int(c)).strftime("%Y-%m-%d"), None
        else:
            return datetime(int(c), int(b), int(a)).strftime("%Y-%m-%d"), None
    except ValueError as e:
        return "", f"Invalid date {raw!r}: {e}"

# ─── JOB NUMBER NORMALIZER ───────────────────────────────────────────────────

def normalize_job_number(raw):
    raw = raw.strip()
    if "/" in raw:
        primary = raw.split("/")[0].strip()
        return primary, f"Slash job number {raw!r} — all hours assigned to {primary!r}"
    return raw, None

# ─── PDF ROW EXTRACTOR ───────────────────────────────────────────────────────

def extract_rows_from_pdf(pdf_path):
    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue
            for line in text.splitlines():
                line = line.strip()
                if not line:
                    continue
                if line.startswith("Sno") or line.lower().startswith("total"):
                    continue
                rows.append({"raw_line": line, "source_file": pdf_path.name})
    return rows

# ─── ROW PARSER ──────────────────────────────────────────────────────────────

DATE_PATTERN = re.compile(r"^\d{2,4}[-/]\d{2}[-/]\d{2,4}")

def parse_row(raw):
    line   = raw["raw_line"]
    source = raw["source_file"]

    if not DATE_PATTERN.match(line):
        return None, None

    try:
        tokens   = line.split()
        date_raw = tokens[0]
        job_raw  = tokens[1]

        # Find job type by scanning token pairs — robust to variable descriptions
        jt_start     = None
        job_type_raw = None
        for jt in JOB_TYPE_MAP:
            jt_tokens = jt.split()
            for i in range(2, len(tokens) - len(jt_tokens) + 1):
                if tokens[i:i + len(jt_tokens)] == jt_tokens:
                    jt_start     = i
                    job_type_raw = jt
                    break
            if jt_start is not None:
                break

        if job_type_raw is None:
            return None, {"source_file": source, "raw_line": line,
                          "issue": f"Unknown job type in: {line!r}"}

        # Hours = first numeric token strictly after job type tokens
        search_from = jt_start + len(job_type_raw.split())
        hours_idx   = None
        for i in range(search_from, len(tokens)):
            if re.match(r"^\d+(\.\d+)?$", tokens[i]):
                hours_idx = i
                break

        if hours_idx is None:
            return None, {"source_file": source, "raw_line": line,
                          "issue": "Could not locate hours field after job type"}

        hours_raw    = tokens[hours_idx]
        designer_raw = " ".join(tokens[hours_idx + 1:]).strip()

        # Normalize date
        date_iso, date_err = normalize_date(date_raw)
        if date_err:
            return None, {"source_file": source, "raw_line": line, "issue": date_err}

        # Normalize job number
        job_number, job_warning = normalize_job_number(job_raw)

        # Resolve designer
        person_code = None
        for key, code in DESIGNER_MAP.items():
            if key.lower() in designer_raw.lower():
                person_code = code
                break

        if not person_code:
            return None, {"source_file": source, "raw_line": line,
                          "issue": f"Unknown designer: {designer_raw!r}"}

        actor_role = JOB_TYPE_MAP[job_type_raw]
        hours      = float(hours_raw)

        idempotency_key = hashlib.md5(
            f"{CLIENT_CODE}|{person_code}|{job_number}|{date_iso}|{actor_role}|{hours}".encode()
        ).hexdigest()

        clean = {
            "client_code":       CLIENT_CODE,
            "person_code":       person_code,
            "job_number":        job_number,
            "date":              date_iso,
            "actor_role":        actor_role,
            "hours":             hours,
            "job_type_original": job_type_raw,
            "source_file":       source,
            "idempotency_key":   idempotency_key,
            "warning":           job_warning or "",
        }
        return clean, None

    except Exception as e:
        return None, {"source_file": source, "raw_line": line, "issue": f"Parse error: {e}"}

# ─── MAIN ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Norspan PDF Extractor")
    parser.add_argument("--input",  required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_dir  = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    pdf_files = sorted(input_dir.glob("*.pdf"))
    if not pdf_files:
        print(f"No PDF files found in {input_dir}")
        return

    manifest   = []
    exceptions = []

    for pdf_path in pdf_files:
        print(f"\nProcessing: {pdf_path.name}")
        raw_rows        = extract_rows_from_pdf(pdf_path)
        clean_rows      = []
        file_exceptions = []

        for raw in raw_rows:
            clean, exc = parse_row(raw)
            if clean:
                clean_rows.append(clean)
            elif exc:
                file_exceptions.append(exc)

        exceptions.extend(file_exceptions)

        if clean_rows:
            csv_name = pdf_path.stem + ".csv"
            csv_path = output_dir / csv_name
            fieldnames = ["client_code","person_code","job_number","date",
                          "actor_role","hours","job_type_original",
                          "source_file","idempotency_key","warning"]
            with open(csv_path, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(clean_rows)

            total_hours = round(sum(r["hours"] for r in clean_rows), 2)
            checksum    = hashlib.md5(
                "".join(r["idempotency_key"] for r in clean_rows).encode()
            ).hexdigest()

            manifest.append({
                "source_file": pdf_path.name,
                "csv_file":    csv_name,
                "row_count":   len(clean_rows),
                "total_hours": total_hours,
                "exceptions":  len(file_exceptions),
                "checksum":    checksum,
                "status":      "READY" if not file_exceptions else "READY_WITH_WARNINGS",
            })
            print(f"  ✅ {len(clean_rows)} rows | {total_hours} hrs | {len(file_exceptions)} exceptions")
        else:
            print(f"  ⚠️  No clean rows extracted")
            manifest.append({
                "source_file": pdf_path.name, "csv_file": None,
                "row_count": 0, "total_hours": 0,
                "exceptions": len(file_exceptions), "checksum": None, "status": "FAILED",
            })

    with open(output_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    with open(output_dir / "exceptions.json", "w") as f:
        json.dump(exceptions, f, indent=2)

    total_rows  = sum(m["row_count"] for m in manifest)
    total_hours = round(sum(m["total_hours"] for m in manifest), 2)

    print(f"\n{'='*50}")
    print(f"EXTRACTION COMPLETE")
    print(f"  Files     : {len(manifest)}")
    print(f"  Rows      : {total_rows}")
    print(f"  Hours     : {total_hours}  (expected: 616.15)")
    print(f"  Exceptions: {len(exceptions)}")
    print(f"  Output    : {output_dir}")
    print(f"{'='*50}")

if __name__ == "__main__":
    main()

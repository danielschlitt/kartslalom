#!/usr/bin/env python3
"""
Parse the C-A-S Mohr championship PDFs (HMJ Zwischenstand + ADAC regional
standings) into JSON that `scripts/seed-endlauf26.ts` consumes.

Why Python: we need cell *colours* (green = qualified for the Endläufe,
yellow = shared place) and exact column positions, which the plain text
layer does not preserve. pdfplumber exposes both.

Usage:
    python3 -m venv /tmp/pdfenv && /tmp/pdfenv/bin/pip install pdfplumber
    /tmp/pdfenv/bin/python webapp/scripts/endlauf26/parse-pdfs.py \
        --hmj data/endlauf26/source/2026_hmj_KS_Hessische_Meisterschaft_Zwischenstand.pdf \
        --adac Süd=data/endlauf26/source/JKS-Sued-260816.pdf \
        --adac Nord=data/endlauf26/source/JKS-Nord-260816.pdf \
        --adac Ost=data/endlauf26/source/JKS-Ost_260831.pdf \
        --out data/endlauf26

Output: <out>/hmj.json and <out>/adac-hth.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path

import pdfplumber

GREEN = (0.572549, 0.815686, 0.313726)

# Points scale used by both championships (place -> points). Places > 35
# receive 1 point when started.
POINTS = {
    1: 40, 2: 37, 3: 35, 4: 33, 5: 31, 6: 30, 7: 29, 8: 28, 9: 27, 10: 26,
    11: 25, 12: 24, 13: 23, 14: 22, 15: 21, 16: 20, 17: 19, 18: 18, 19: 17,
    20: 16, 21: 15, 22: 14, 23: 13, 24: 12, 25: 11, 26: 10, 27: 9, 28: 8,
    29: 7, 30: 6, 31: 5, 32: 4, 33: 3, 34: 2, 35: 1,
}


def points_for(place: int) -> int:
    return POINTS.get(place, 1)


# Club name clean-up. The source lists spell the same club several ways.
CLUB_ALIASES = {
    "MSC Rodenstein": "MSC Rodenstein Fr.- Crumbach",
    "MASC Rodenstein": "MSC Rodenstein Fr.- Crumbach",
    "MSC Rodenstein Fr.-Crumbach": "MSC Rodenstein Fr.- Crumbach",
    "AMSG Schalmstadt Frielendorf": "AMSG Schwalmstadt Frielendorf",
    "VFM/MSC Affolterbach": "VfM/MSC Affolterbach",
    "VFM /AC Wetzlar": "VfM/AC Wetzlar",
    "VFM/AC Wetzlar": "VfM/AC Wetzlar",
    "VFM/AC Bensheim": "VfM/AC Bensheim",
    "VFM /AC Bensheim": "VfM/AC Bensheim",
    "Scuderia Wiebaden": "Scuderia Wiesbaden",
    "MSC Wächtersbach Hesseld": "MSC Wächtersbach-Hesseldorf",
    "AC Bensheim": "VfM/AC Bensheim",
}

# Typos that appear *inside* otherwise valid names (fixed before matching).
CLUB_TYPOS = {
    "Schalmstadt": "Schwalmstadt",
    "Wiebaden": "Wiesbaden",
}

# Long club names overflow their column in the HMJ list and get interleaved
# with the Verband text. When the truncated cell is a prefix of one of these,
# we use the full name.
LONG_CLUBS = (
    "AMSG Schwalmstadt Frielendorf",
    "MSC Wächtersbach-Hesseldorf",
    "MSC Werratal Witzenhausen",
    "MSC Reinhardswald Hofgeismar",
    "MSC Rodenstein Fr.- Crumbach",
    "MC Heilbad Heiligenstadt",
    "MC Hermsdorfer Kreuz",
)

REGION_TOKENS = ("Süd", "Nord", "Ost", "DMV")


def normalize_club(raw: str) -> str:
    s = re.sub(r"\s+", " ", raw).strip()
    for bad, good in CLUB_TYPOS.items():
        s = s.replace(bad, good)
    s = CLUB_ALIASES.get(s, s)
    if len(s) >= 10:
        for full in LONG_CLUBS:
            if full.startswith(s) or full.replace("-", " ").startswith(s.replace("-", " ")):
                return full
    return s


def split_name_and_club(name_cell: str, club_cell: str) -> tuple[str, str]:
    """Very long names overflow into the club cell ("Cassandr" | "aMSC …")."""
    m = re.match(r"^([a-zäöüß]+)(?=[A-Z])", club_cell)
    if m:
        return name_cell + m.group(1), club_cell[m.end():]
    return name_cell, club_cell


def extract_region(cell: str) -> tuple[str | None, str]:
    """
    Find a region/Verband token in a cell whose characters may be interleaved
    with overflowing club text. Returns (token, leftover_chars).
    Exact substring wins; otherwise the token must appear as a subsequence.
    """
    for tok in REGION_TOKENS:
        if tok in cell:
            return tok, cell.replace(tok, "", 1).strip()
    for tok in REGION_TOKENS:
        rest = list(cell)
        ok = True
        for ch in tok:
            try:
                idx = rest.index(ch)
            except ValueError:
                ok = False
                break
            rest.pop(idx)
        if ok:
            return tok, "".join(rest).strip()
    return None, cell


def split_name(raw: str) -> tuple[str, str]:
    """`Glatter Jonas` -> ("Glatter", "Jonas"); first token is the last name."""
    parts = re.sub(r"\s+", " ", raw).strip().split(" ")
    # Lower-case particles ("van den Daele Emily") belong to the last name.
    n = 1
    while n < len(parts) - 1 and parts[n - 1][:1].islower():
        n += 1
    last = " ".join(parts[:n])
    first = " ".join(parts[n:]).replace(".", " ").strip()
    first = re.sub(r"\s+", " ", first)
    return last, first


@dataclass
class RaceResult:
    race: int
    position: int
    points: int
    struck: bool


@dataclass
class DriverRow:
    position: int
    qualified: bool
    lastName: str
    firstName: str
    club: str
    racesStarted: int
    total: float
    results: list[RaceResult] = field(default_factory=list)
    verband: str | None = None
    adacId: str | None = None


# ───────────────────────────── geometry helpers ─────────────────────────────


def cluster(values: list[float], tol: float = 2.0) -> list[float]:
    out: list[float] = []
    for v in sorted(values):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def table_lines(page):
    """Return (column_xs, row_ys) derived from the thin black table rules."""
    vert, horiz = [], []
    for r in page.rects:
        c = r.get("non_stroking_color")
        if c not in ((0, 0, 0), (0.0, 0.0, 0.0), [0, 0, 0], [0.0, 0.0, 0.0], 0, (0,)):
            continue
        w = r["x1"] - r["x0"]
        h = r["bottom"] - r["top"]
        if w < 1.5 and h > 10:
            vert.append(((r["x0"] + r["x1"]) / 2, r["top"], r["bottom"]))
        elif h < 1.5 and w > 200:
            horiz.append(((r["top"] + r["bottom"]) / 2, r["x0"], r["x1"]))
    # The body of the table starts where most vertical rules start (the
    # header rules above it are shorter). Keep every rule that spans the body,
    # including the outer border which starts higher up on the first page.
    if not vert:
        return [], []
    tops = [round(v[1]) for v in vert]
    body_top = max(set(tops), key=tops.count)
    col_xs = cluster(
        [v[0] for v in vert if v[1] <= body_top + 3 and v[2] >= body_top + 5]
    )
    # The header's bottom rule is sometimes drawn thicker than 1.5pt and is
    # then missing from `horiz`; the body top always bounds the first row.
    row_ys = cluster([body_top] + [h[0] for h in horiz if h[0] >= body_top - 1])
    return col_xs, row_ys


def green_bands(page, x_lo: float, x_hi: float) -> list[tuple[float, float]]:
    bands = []
    for r in page.rects:
        c = r.get("non_stroking_color")
        if not c:
            continue
        try:
            if all(abs(c[i] - GREEN[i]) < 0.02 for i in range(3)):
                cx = (r["x0"] + r["x1"]) / 2
                if x_lo - 1 <= cx <= x_hi + 1:
                    bands.append((r["top"], r["bottom"]))
        except (TypeError, IndexError):
            continue
    return bands


def cell_texts(page, col_xs, y0, y1) -> list[str]:
    """Split the chars between y0..y1 into one string per column."""
    cells: list[list] = [[] for _ in range(len(col_xs) - 1)]
    for ch in page.chars:
        cy = (ch["top"] + ch["bottom"]) / 2
        if not (y0 < cy < y1):
            continue
        cx = (ch["x0"] + ch["x1"]) / 2
        for i in range(len(col_xs) - 1):
            if col_xs[i] <= cx < col_xs[i + 1]:
                cells[i].append(ch)
                break
    out = []
    for chars in cells:
        chars.sort(key=lambda c: c["x0"])
        s = ""
        prev_x1 = None
        for c in chars:
            if prev_x1 is not None and c["x0"] - prev_x1 > 1.2:
                s += " "
            s += c["text"]
            prev_x1 = c["x1"]
        out.append(s.strip())
    return out


RESULT_RE = re.compile(r"^\*?(\d+)(?:\s+(\d+))?$")


def parse_result_cell(text: str, race: int) -> RaceResult | None:
    text = text.strip()
    if not text:
        return None
    m = RESULT_RE.match(text)
    if not m:
        raise ValueError(f"unparseable result cell {text!r}")
    struck = text.startswith("*")
    pos = int(m.group(1))
    pts = int(m.group(2)) if m.group(2) else points_for(pos)
    return RaceResult(race=race, position=pos, points=pts, struck=struck)


def page_class_number(page) -> int | None:
    text = page.extract_text() or ""
    m = re.search(r"Klasse:\s*(\d+)", text)
    return int(m.group(1)) if m else None


def page_stand(page) -> str | None:
    text = page.extract_text() or ""
    m = re.search(r"Stand:\s*(\d{2}\.\d{2}\.\d{4})", text)
    return m.group(1) if m else None


# ───────────────────────────── HMJ ─────────────────────────────


def parse_hmj(path: Path) -> dict:
    classes: dict[int, list[DriverRow]] = {}
    stand = None
    current_class = None
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            cls = page_class_number(page)
            if cls is not None:
                current_class = cls
            stand = stand or page_stand(page)
            if current_class is None:
                continue
            col_xs, row_ys = table_lines(page)
            if len(col_xs) < 14:
                raise ValueError(f"unexpected HMJ column count {len(col_xs)} on page {page.page_number}")
            # Columns: Plz | mark | Name | Club | Verband | Läufe | L1..L5 | E1 | E2 | Gesamt
            greens = green_bands(page, col_xs[1], col_xs[2])
            rows = classes.setdefault(current_class, [])
            for y0, y1 in zip(row_ys, row_ys[1:]):
                cells = cell_texts(page, col_xs, y0, y1)
                if not cells[0] or not cells[0].isdigit():
                    continue
                cy = (y0 + y1) / 2
                qualified = any(t <= cy <= b for t, b in greens)
                name_raw, club_raw = split_name_and_club(cells[2], cells[3])
                last, first = split_name(name_raw)
                verband_raw = cells[4]
                verband, _spill = extract_region(verband_raw)
                if verband is None:
                    raise ValueError(f"no Verband in {verband_raw!r} for {cells[2]}")
                # Long club names overflow into the Verband cell and interleave
                # with it ("seNnord"); the truncated prefix is resolved against
                # LONG_CLUBS inside normalize_club.
                club = normalize_club(club_raw)
                results = []
                for i in range(5):
                    r = parse_result_cell(cells[6 + i], i + 1)
                    if r:
                        results.append(r)
                total = float(cells[13].replace(".", "").replace(",", "."))
                rows.append(
                    DriverRow(
                        position=int(cells[0]),
                        qualified=qualified,
                        lastName=last,
                        firstName=first,
                        club=club,
                        verband=verband,
                        racesStarted=int(cells[5]) if cells[5].isdigit() else len(results),
                        total=total,
                        results=results,
                    )
                )
    verify(classes, "hmj")
    return {
        "championship": "hmj",
        "source": path.name,
        "stand": stand,
        "classes": [
            {"number": n, "drivers": [asdict(d) for d in rows]}
            for n, rows in sorted(classes.items())
        ],
    }


# ───────────────────────────── ADAC ─────────────────────────────


def parse_adac(region: str, path: Path) -> dict:
    classes: dict[int, list[DriverRow]] = {}
    stand = None
    current_class = None
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            cls = page_class_number(page)
            if cls is not None:
                current_class = cls
            stand = stand or page_stand(page)
            if current_class is None:
                continue
            col_xs, row_ys = table_lines(page)
            # Columns: Plz | mark | Name | Club | Ausweis | Läufe | (Platz Pkte) x N | Gesamt
            if len(col_xs) < 8:
                raise ValueError(f"unexpected ADAC column count {len(col_xs)} on page {page.page_number}")
            greens = green_bands(page, col_xs[1], col_xs[2])
            race_cols = list(range(6, len(col_xs) - 2))
            rows = classes.setdefault(current_class, [])
            for y0, y1 in zip(row_ys, row_ys[1:]):
                cells = cell_texts(page, col_xs, y0, y1)
                if not cells[0] or not cells[0].isdigit():
                    continue
                cy = (y0 + y1) / 2
                qualified = any(t <= cy <= b for t, b in greens)
                name_raw, club_raw = split_name_and_club(cells[2], cells[3])
                last, first = split_name(name_raw)
                club = normalize_club(club_raw)
                adac_id = cells[4].strip() or None
                results = []
                for idx, ci in enumerate(race_cols):
                    r = parse_result_cell(cells[ci], idx + 1)
                    if r:
                        results.append(r)
                total_txt = cells[-1].replace(".", "").replace(",", ".")
                total = float(total_txt) if total_txt else 0.0
                rows.append(
                    DriverRow(
                        position=int(cells[0]),
                        qualified=qualified,
                        lastName=last,
                        firstName=first,
                        club=club,
                        adacId=adac_id,
                        racesStarted=int(cells[5]) if cells[5].isdigit() else len(results),
                        total=total,
                        results=results,
                    )
                )
    verify(classes, f"adac {region}")
    return {
        "region": region,
        "source": path.name,
        "stand": stand,
        "classes": [
            {"number": n, "drivers": [asdict(d) for d in rows]}
            for n, rows in sorted(classes.items())
        ],
    }


def verify(classes: dict[int, list[DriverRow]], label: str) -> None:
    problems = 0
    for n, rows in classes.items():
        for d in rows:
            counted = sum(r.points for r in d.results if not r.struck)
            if abs(counted - d.total) > 0.01:
                problems += 1
                print(
                    f"[{label}] class {n} {d.lastName} {d.firstName}: sum {counted} != total {d.total}",
                    file=sys.stderr,
                )
    q = sum(1 for rows in classes.values() for d in rows if d.qualified)
    t = sum(len(rows) for rows in classes.values())
    print(f"[{label}] classes={sorted(classes)} drivers={t} qualified={q} problems={problems}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hmj", type=Path)
    ap.add_argument("--adac", action="append", default=[], help="Region=path.pdf")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    if args.hmj:
        data = parse_hmj(args.hmj)
        (args.out / "hmj.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.adac:
        regions = []
        for spec in args.adac:
            region, _, p = spec.partition("=")
            regions.append(parse_adac(region, Path(p)))
        data = {"championship": "adac-hth", "regions": regions}
        (args.out / "adac-hth.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

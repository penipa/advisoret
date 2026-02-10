import csv
from pathlib import Path

SRC = Path(__file__).parent / "venue_enrichment_premiados_coords_OK.csv"
DST = Path(__file__).parent / "venue_enrichment_premiados_coords_OK_min.csv"

def main():
    if not SRC.exists():
        raise FileNotFoundError(f"No existe: {SRC}")

    with SRC.open(newline="", encoding="utf-8") as f, DST.open("w", newline="", encoding="utf-8") as g:
        r = csv.DictReader(f)
        w = csv.DictWriter(g, fieldnames=["venue_id", "lat", "lon"])
        w.writeheader()

        kept = 0
        for row in r:
            venue_id = (row.get("venue_id") or "").strip()
            lat = (row.get("lat") or "").strip()
            lon = (row.get("lon") or "").strip()
            if venue_id and lat and lon:
                w.writerow({"venue_id": venue_id, "lat": lat, "lon": lon})
                kept += 1

    print(f"Generado: {DST} (rows={kept})")

if __name__ == "__main__":
    main()

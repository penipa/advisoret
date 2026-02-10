import csv
import sys
from pathlib import Path

def main():
    if len(sys.argv) < 3:
        print("Uso: python prep_overpass_csv.py overpass_cv.csv osm_venues_import.csv")
        sys.exit(1)

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])

    if not src.exists():
        raise FileNotFoundError(f"No existe: {src}")

    # Overpass suele exportar columnas con nombres especiales.
    # Vamos a mapear por nombre “probable” y ser tolerantes.
    def get(row, *keys):
        for k in keys:
            if k in row and row[k] is not None:
                return str(row[k]).strip()
        return ""

    kept = 0
    with src.open(newline="", encoding="utf-8") as f, dst.open("w", newline="", encoding="utf-8") as g:
        r = csv.DictReader(f)

        out_fields = [
            "osm_type","osm_id","name","amenity",
            "addr_city","addr_street","addr_housenumber","addr_postcode",
            "website","phone",
            "lat","lon"
        ]
        w = csv.DictWriter(g, fieldnames=out_fields)
        w.writeheader()

        for row in r:
            osm_type = get(row, "@type", "::type", "type")
            osm_id   = get(row, "@id", "::id", "id")
            name     = get(row, "name")
            amenity  = get(row, "amenity")

            addr_city = get(row, "addr:city", "addr_city")
            addr_street = get(row, "addr:street", "addr_street")
            addr_hn = get(row, "addr:housenumber", "addr_housenumber")
            addr_pc = get(row, "addr:postcode", "addr_postcode")

            website = get(row, "website")
            phone = get(row, "phone", "contact:phone", "contact_phone")

            lat = get(row, "@lat", "::lat", "lat")
            lon = get(row, "@lon", "::lon", "lon")

            # filtro mínimo “pro”: nombre + lat/lon
            if not name or not lat or not lon:
                continue

            w.writerow({
                "osm_type": osm_type,
                "osm_id": osm_id,
                "name": name,
                "amenity": amenity,
                "addr_city": addr_city,
                "addr_street": addr_street,
                "addr_housenumber": addr_hn,
                "addr_postcode": addr_pc,
                "website": website,
                "phone": phone,
                "lat": lat,
                "lon": lon,
            })
            kept += 1

    print(f"Generado: {dst} (rows={kept})")

if __name__ == "__main__":
    main()

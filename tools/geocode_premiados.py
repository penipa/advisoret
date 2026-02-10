import csv
import time
import urllib.parse
import unicodedata
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

import requests

# --- Rutas robustas ---
BASE_DIR = Path(__file__).resolve().parent
INPUT = str(BASE_DIR / "premiados_sin_coords.csv")

OUT_ALL = str(BASE_DIR / "venue_enrichment_premiados_coords_ALL.csv")
OUT_OK = str(BASE_DIR / "venue_enrichment_premiados_coords_OK.csv")
OUT_REVIEW = str(BASE_DIR / "venue_enrichment_premiados_coords_REVIEW.csv")

# --- Geocoders sin API key ---
NOMINATIM_URLS = [
    "https://nominatim.openstreetmap.org/search",
    "https://nominatim.openstreetmap.de/search",
]

PHOTON_URL = "https://photon.komoot.io/api"  # Pelias/Photon, muy útil para negocios

HEADERS = {
    "User-Agent": "Advisoret/1.0 (PabloPenichet; contacto: pablo_penichet@yahoo.es)",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Referer": "https://advisoret.app",
}

RATE_LIMIT_SECONDS = 1.2  # Conservador para no molestar


def strip_accents(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn")


def norm(s: str) -> str:
    s = (s or "").strip()
    s = strip_accents(s).lower()
    # Normalización suave
    s = s.replace("’", "'")
    s = " ".join(s.split())
    return s


def sanitize_address(value: str) -> str:
    v = (value or "").strip()
    if v.lower() in ("null", "none", "nan"):
        return ""
    return v


def simplify_city(city: str) -> str:
    """
    Quita paréntesis tipo "Valencia (Campanar)" -> "Valencia"
    y limpia espacios.
    """
    c = (city or "").strip()
    if "(" in c:
        c = c.split("(")[0].strip()
    return c


def extract_query_from_google_maps_url(url: str) -> str:
    """
    google_maps_url suele ser:
    https://www.google.com/maps/search/?api=1&query=...
    """
    if not url:
        return ""
    try:
        parsed = urllib.parse.urlparse(url)
        qs = urllib.parse.parse_qs(parsed.query)
        q = qs.get("query", [""])[0]
        return (q or "").strip()
    except Exception:
        return ""


def build_queries(name: str, city: str, address: str, q_maps: str) -> list[str]:
    """
    Devuelve lista de queries en orden de preferencia.
    Probamos varias variantes para maximizar aciertos.
    """
    name = (name or "").strip()
    city_simple = simplify_city(city)
    address = sanitize_address(address)

    base_tail = "Comunitat Valenciana, España"

    qs = []
    if address:
        qs.append(f"{name}, {address}, {city_simple}, {base_tail}")
        qs.append(f"{name}, {address}, {city_simple}")
    if q_maps:
        qs.append(q_maps)

    # Variantes con prefijos típicos (OSM a veces lo tiene como "Bar X" o "Restaurante X")
    qs.append(f"{name}, {city_simple}, {base_tail}")
    qs.append(f"Restaurante {name}, {city_simple}, {base_tail}")
    qs.append(f"Bar {name}, {city_simple}, {base_tail}")

    # Sin cola geográfica (a veces ayuda si ya está en q_maps)
    qs.append(f"{name}, {city_simple}")

    # Dedup manteniendo orden
    seen = set()
    out = []
    for q in qs:
        qq = " ".join(q.split()).strip()
        if qq and qq not in seen:
            seen.add(qq)
            out.append(qq)
    return out


def nominatim_search(query: str) -> Tuple[Optional[float], Optional[float], str, str]:
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
    }

    last_err = None
    for base in NOMINATIM_URLS:
        try:
            r = requests.get(base, params=params, headers=HEADERS, timeout=25)
            if r.status_code == 403:
                last_err = f"403 Forbidden on {base}"
                continue
            r.raise_for_status()
            data = r.json()
            if not data:
                return None, None, "", "nominatim"
            lat = float(data[0]["lat"])
            lon = float(data[0]["lon"])
            disp = data[0].get("display_name", "")
            return lat, lon, disp, "nominatim"
        except Exception as e:
            last_err = str(e)
            continue

    # Si aquí, fue error duro (no solo vacío)
    if last_err:
        raise RuntimeError(last_err)
    return None, None, "", "nominatim"


def photon_search(query: str) -> Tuple[Optional[float], Optional[float], str, str]:
    params = {
        "q": query,
        "limit": 1,
        # "lang": "es",  # photon no siempre respeta, pero no hace daño
    }

    r = requests.get(PHOTON_URL, params=params, headers=HEADERS, timeout=25)
    r.raise_for_status()
    data = r.json()
    feats = data.get("features") or []
    if not feats:
        return None, None, "", "photon"

    geom = feats[0].get("geometry", {})
    coords = geom.get("coordinates") or []
    if len(coords) != 2:
        return None, None, "", "photon"

    lon = float(coords[0])
    lat = float(coords[1])
    props = feats[0].get("properties") or {}
    disp = props.get("name") or props.get("street") or props.get("city") or ""
    # photon no trae display_name tipo nominatim; hacemos uno “humano”
    display = f"{props.get('name','')}, {props.get('street','')}, {props.get('city','')}".strip(", ").strip()
    return lat, lon, display, "photon"


def is_plausible_match(venue_name: str, display: str) -> bool:
    """
    Heurística simple: si una parte significativa del nombre aparece en el display.
    Evita falsos positivos tipo "Els Arcs" -> polideportivo.
    """
    vn = norm(venue_name)
    d = norm(display)

    if not vn or not d:
        return False

    # Quitamos palabras comunes que no ayudan
    stop = {"bar", "restaurante", "restaurant", "cafeteria", "cafe", "grupo", "el", "la", "los", "las", "de", "del", "i"}
    tokens = [t for t in vn.replace("-", " ").replace("(", " ").replace(")", " ").split() if t and t not in stop]

    if not tokens:
        return False

    # Requerimos que al menos 1-2 tokens “raros” estén presentes
    hits = sum(1 for t in tokens if len(t) >= 4 and t in d)

    # Umbral: si el nombre tiene pocos tokens, con 1 vale; si muchos, pedimos 2
    if len(tokens) <= 2:
        return hits >= 1
    return hits >= 2


def geocode_with_fallback(venue_name: str, queries: list[str]) -> Dict[str, Any]:
    """
    Prueba nominatim y photon en varias queries.
    Devuelve dict con resultado y status: OK / SUSPECT / MISS
    """
    for q in queries:
        # 1) Nominatim
        try:
            lat, lon, disp, svc = nominatim_search(q)
            if lat is not None and lon is not None:
                plausible = is_plausible_match(venue_name, disp)
                return {
                    "status": "OK" if plausible else "SUSPECT",
                    "lat": lat,
                    "lon": lon,
                    "display": disp,
                    "service": svc,
                    "query_used": q,
                }
        except Exception as e:
            # Error duro (403, etc.). Seguimos con photon
            pass

        # 2) Photon
        try:
            lat, lon, disp, svc = photon_search(q)
            if lat is not None and lon is not None:
                plausible = is_plausible_match(venue_name, disp)
                return {
                    "status": "OK" if plausible else "SUSPECT",
                    "lat": lat,
                    "lon": lon,
                    "display": disp,
                    "service": svc,
                    "query_used": q,
                }
        except Exception:
            pass

        time.sleep(RATE_LIMIT_SECONDS)

    return {
        "status": "MISS",
        "lat": None,
        "lon": None,
        "display": "",
        "service": "",
        "query_used": "",
    }


def main():
    in_path = Path(INPUT)
    if not in_path.exists():
        raise FileNotFoundError(f"No encuentro el CSV de entrada en: {INPUT}")

    rows = []
    with open(in_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)

    total = len(rows)
    out_all = []
    out_ok = []
    out_review = []

    for i, row in enumerate(rows, start=1):
        venue_id = (row.get("venue_id") or "").strip()
        name = (row.get("name") or "").strip()
        city = (row.get("city") or "").strip()
        address = row.get("address_text") or ""
        maps_url = (row.get("google_maps_url") or "").strip()
        q_maps = extract_query_from_google_maps_url(maps_url)

        queries = build_queries(name=name, city=city, address=address, q_maps=q_maps)
        res = geocode_with_fallback(name, queries)

        status = res["status"]
        lat = res["lat"]
        lon = res["lon"]
        disp = res["display"]
        svc = res["service"]
        q_used = res["query_used"]

        if status == "OK":
            print(f"[{i}/{total}] OK   {name} ({city}) -> {lat:.7f}, {lon:.7f} [{svc}]")
        elif status == "SUSPECT":
            print(f"[{i}/{total}] SUSPECT {name} ({city}) -> {lat:.7f}, {lon:.7f} [{svc}] | {disp[:60]}")
        else:
            print(f"[{i}/{total}] MISS {name} ({city}) -> (sin resultado)")

        row_out = {
            "venue_id": venue_id,
            "name": name,
            "city": city,
            "status": status,
            "lat": "" if lat is None else f"{lat:.7f}",
            "lon": "" if lon is None else f"{lon:.7f}",
            "service": svc,
            "query_used": q_used,
            "display": disp,
            # staging fields (solo los mínimos para update):
            "address_text": "",
            "google_maps_url": "",
            "hero_image_url": "",
            "cover_photo_path": "",
        }

        out_all.append(row_out)
        if status == "OK":
            out_ok.append(row_out)
        else:
            out_review.append(row_out)

        time.sleep(RATE_LIMIT_SECONDS)

    # CSVs
    fieldnames = [
        "venue_id",
        "name",
        "city",
        "status",
        "lat",
        "lon",
        "service",
        "query_used",
        "display",
        "address_text",
        "google_maps_url",
        "hero_image_url",
        "cover_photo_path",
    ]

    def write_csv(path: str, data: list[dict]):
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            for r in data:
                w.writerow(r)

    write_csv(OUT_ALL, out_all)
    write_csv(OUT_OK, out_ok)
    write_csv(OUT_REVIEW, out_review)

    print("\nGenerados:")
    print(" -", OUT_ALL)
    print(" -", OUT_OK, "(IMPORTA ESTE a venue_enrichment)")
    print(" -", OUT_REVIEW, "(para revisión manual o segunda pasada)")
    print("\nSiguiente paso: importa el *_OK.csv en public.venue_enrichment y ejecuta el UPDATE de 02_staging_enrichment.sql")


if __name__ == "__main__":
    main()

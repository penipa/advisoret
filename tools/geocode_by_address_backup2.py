from __future__ import annotations

import argparse
import csv
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, parse_qs, unquote_plus

import requests

HEADERS = {
    "User-Agent": "Advisoret/1.0 (PabloPenichet; contacto: pablo_penichet@yahoo.es)",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Referer": "https://advisoret.app",
}

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
PHOTON_URL = "https://photon.komoot.io/api"


def norm(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s*\(.*?\)\s*", " ", s)  # quita paréntesis
    s = s.replace("/", " ")
    trans = str.maketrans(
        "áàäâãéèëêíìïîóòöôõúùüûñç",
        "aaaaaeeeeiiiiooooouuuunc",
    )
    s = s.translate(trans)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def base_city(city: str) -> str:
    c = re.sub(r"\s*\(.*?\)\s*", " ", (city or "")).strip()
    return re.sub(r"\s+", " ", c)


def province_hint(city: str) -> str:
    c = norm(base_city(city))
    if "castellon" in c:
        return "Castellón"
    if "valencia" in c:
        return "Valencia"
    if "alicante" in c or "alacant" in c:
        return "Alicante"
    return ""


def looks_plausible(expected_city: str, haystack: str) -> bool:
    ec = norm(expected_city)
    hs = norm(haystack)
    if not ec:
        return True
    main = ec.split(" ")[0]
    return (ec in hs) or (main in hs)


def strip_generic_prefix(name: str) -> str:
    n = (name or "").strip()
    return re.sub(
        r"^(bar|cafeteria|cafetería|bodega|meson|mesón|restaurante)\s+",
        "",
        n,
        flags=re.IGNORECASE,
    ).strip()


def clean_address(addr: str) -> str:
    a = (addr or "").strip()
    # corta teléfonos y ruido tras separadores típicos
    a = re.split(r"·|\||\btel\.?\b|\btelf\.?\b|\btelefono\b|\bteléfono\b", a, flags=re.IGNORECASE)[0].strip()

    # abreviaturas comunes
    a = re.sub(r"\bC/\b", "Calle ", a, flags=re.IGNORECASE)
    a = re.sub(r"\bAvda\.?\b", "Avenida", a, flags=re.IGNORECASE)
    a = re.sub(r"\bAv\.?\b", "Avenida", a, flags=re.IGNORECASE)
    a = re.sub(r"\bPl\.?\b", "Plaza", a, flags=re.IGNORECASE)

    # partes que suelen liar más que ayudar
    a = re.sub(r"\b(bajo|bloque|grupo|local|portal|piso|puerta)\b.*$", "", a, flags=re.IGNORECASE).strip()

    a = re.sub(r"\s+", " ", a).strip(" ,")
    return a


def parse_gmaps_query(url: str) -> str:
    """Extrae query=... de https://www.google.com/maps/search/?api=1&query=..."""
    if not url:
        return ""
    try:
        u = urlparse(url)
        qs = parse_qs(u.query)
        q = (qs.get("query") or [""])[0]
        return unquote_plus(q).strip()
    except Exception:
        return ""


def extract_street_and_number(addr: str) -> tuple[str, str]:
    """
    Intenta extraer 'street' y 'housenumber' de una dirección tipo:
    'Plaza Tetuán, 19' o 'Calle Sanahuja 53'
    """
    a = (addr or "").strip()
    if not a:
        return "", ""
    # Caso con coma: "X, 19"
    m = re.match(r"^(.*?)[,\s]+(\d+[a-zA-Z]?)\s*$", a)
    if m:
        street = m.group(1).strip()
        num = m.group(2).strip()
        return street, num

    # Caso "X 19"
    m2 = re.match(r"^(.*?\D)\s+(\d+[a-zA-Z]?)\s*$", a)
    if m2:
        street = m2.group(1).strip()
        num = m2.group(2).strip()
        return street, num

    return "", ""


@dataclass
class Hit:
    lat: float
    lon: float
    label: str
    provider: str


def _nominatim_get(params: dict, sleep_s: float) -> list:
    """
    Llamada a Nominatim con gestión básica de rate-limit.
    """
    r = requests.get(NOMINATIM_URL, params=params, headers=HEADERS, timeout=25)

    # Si rate limit / forbidden, no lo conviertas en "MISS" silencioso
    if r.status_code in (429, 403):
        raise RuntimeError(f"Nominatim HTTP {r.status_code}: {r.text[:120]}")

    r.raise_for_status()
    time.sleep(sleep_s)  # respeta Nominatim
    data = r.json()
    return data if isinstance(data, list) else []


def query_nominatim_freeform(q: str, sleep_s: float) -> Optional[Hit]:
    params = {
        "q": q,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
        "countrycodes": "es",
        "email": "pablo_penichet@yahoo.es",
    }
    data = _nominatim_get(params, sleep_s)
    if not data:
        return None
    it = data[0]
    return Hit(lat=float(it["lat"]), lon=float(it["lon"]), label=it.get("display_name", ""), provider="nominatim")


def query_nominatim_structured(street: str, housenumber: str, city: str, sleep_s: float) -> Optional[Hit]:
    if not street or not housenumber or not city:
        return None
    params = {
        "street": f"{street} {housenumber}".strip(),
        "city": city,
        "country": "Spain",
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
        "countrycodes": "es",
        "email": "pablo_penichet@yahoo.es",
    }
    data = _nominatim_get(params, sleep_s)
    if not data:
        return None
    it = data[0]
    return Hit(lat=float(it["lat"]), lon=float(it["lon"]), label=it.get("display_name", ""), provider="nominatim_struct")


def query_photon(q: str) -> Optional[Hit]:
    params = {"q": q, "limit": 1, "lang": "es"}
    r = requests.get(PHOTON_URL, params=params, headers=HEADERS, timeout=25)
    r.raise_for_status()
    data = r.json()
    feats = data.get("features") or []
    if not feats:
        return None
    f = feats[0]
    coords = f["geometry"]["coordinates"]
    props = f.get("properties") or {}
    label = " | ".join(
        [str(props.get(k)) for k in ("name", "street", "housenumber", "city", "state", "country") if props.get(k)]
    )
    return Hit(lat=float(coords[1]), lon=float(coords[0]), label=label, provider="photon")


def build_query(name: str, address: str, city: str) -> str:
    c = base_city(city)
    prov = province_hint(city)
    parts = [name.strip()]
    if address and address.strip():
        parts.append(address.strip())
    parts.append(c)
    if prov and prov.lower() not in c.lower():
        parts.append(prov)
    parts.append("Comunitat Valenciana")
    parts.append("España")
    return ", ".join([p for p in parts if p])


def try_geocode_freeform(q: str, sleep_s: float) -> Optional[Hit]:
    # Nominatim -> Photon
    try:
        h = query_nominatim_freeform(q, sleep_s)
    except Exception:
        h = None
    if h is not None:
        return h
    try:
        return query_photon(q)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="venues_need_coords.csv")
    ap.add_argument("--out_ok", default="venue_coords_OK.csv")
    ap.add_argument("--out_review", default="venue_coords_REVIEW.csv")
    ap.add_argument("--sleep", type=float, default=1.2, help="segundos entre requests (Nominatim)")
    args = ap.parse_args()

    base = Path(__file__).resolve().parent

    inp = Path(args.input)
    if not inp.is_absolute():
        inp = base / inp

    out_ok = Path(args.out_ok)
    if not out_ok.is_absolute():
        out_ok = base / out_ok

    out_review = Path(args.out_review)
    if not out_review.is_absolute():
        out_review = base / out_review

    rows = []
    with inp.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(row)

    ok_rows: list[dict] = []
    review_rows: list[dict] = []
    total = len(rows)

    for i, row in enumerate(rows, start=1):
        venue_id = (row.get("venue_id") or row.get("id") or "").strip()
        name = (row.get("name") or "").strip()
        city = (row.get("city") or "").strip()
        addr_raw = (row.get("address_text") or "").strip()
        addr = clean_address(addr_raw)
        gmaps_url = (row.get("google_maps_url") or "").strip()
        gmaps_q = parse_gmaps_query(gmaps_url)

        prov = province_hint(city)
        base_c = base_city(city)

        queries: list[tuple[str, str]] = []

        # 1) Address-first (muy potente en capitales)
        if addr:
            q_addr = ", ".join([p for p in [addr, base_c, prov if prov and prov.lower() not in base_c.lower() else "", "España"] if p])
            queries.append(("ADDR", q_addr))

        # 2) Google Maps query (oro si existe)
        if gmaps_q:
            queries.append(("GMAPS", gmaps_q))

        # 3) Name + address + city
        q_full = build_query(name, addr, city)
        queries.append(("FULL", q_full))

        # 4) Alt name (sin “Bar/Cafetería/…”) + address
        alt_name = strip_generic_prefix(name)
        if alt_name and alt_name.lower() != name.lower():
            q_alt = build_query(alt_name, addr, city)
            queries.append(("ALT", q_alt))

        # 5) Name + city
        q_name_city = ", ".join([p for p in [name, base_c, prov if prov and prov.lower() not in base_c.lower() else "", "España"] if p])
        queries.append(("NAME_CITY", q_name_city))

        hit: Optional[Hit] = None
        used = ""

        # Extra: intento “structured” solo si parece calle+número y estamos en Valencia/Alicante
        # (Esto reduce los “te manda a otro pueblo”)
        street, num = extract_street_and_number(addr)
        can_structured = bool(street and num and base_c in ("Valencia", "Alicante"))

        if can_structured:
            used = f"STRUCT:{street} {num} | city={base_c}"
            try:
                hit = query_nominatim_structured(street, num, base_c, args.sleep)
            except Exception:
                hit = None

        # Freeform fallbacks
        if hit is None:
            for tag, q in queries:
                used = f"{tag}:{q}"
                hit = try_geocode_freeform(q, args.sleep)
                if hit is not None:
                    break

        if hit is None:
            print(f"[{i}/{total}] MISS    {name} ({city}) -> sin resultado")
            review_rows.append(
                {
                    "venue_id": venue_id,
                    "name": name,
                    "city": city,
                    "address_text": addr,
                    "google_maps_url": gmaps_url,
                    "query_used": used,
                    "provider": "",
                    "lat": "",
                    "lon": "",
                    "label": "",
                    "reason": "no_result",
                }
            )
            continue

        # Gate ciudad
        if looks_plausible(city, hit.label):
            status = "OK"
            ok_rows.append(
                {
                    "venue_id": venue_id,
                    "lat": hit.lat,
                    "lon": hit.lon,
                    "provider": hit.provider,
                    "label": hit.label,
                    "query_used": used,
                }
            )
        else:
            status = "SUSPECT"
            review_rows.append(
                {
                    "venue_id": venue_id,
                    "name": name,
                    "city": city,
                    "address_text": addr,
                    "google_maps_url": gmaps_url,
                    "query_used": used,
                    "provider": hit.provider,
                    "lat": hit.lat,
                    "lon": hit.lon,
                    "label": hit.label,
                    "reason": "city_mismatch",
                }
            )

        print(f"[{i}/{total}] {status:7} {name} ({city}) -> {hit.lat:.7f}, {hit.lon:.7f} [{hit.provider}] | {hit.label[:90]}")

    with out_ok.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["venue_id", "lat", "lon", "provider", "label", "query_used"])
        w.writeheader()
        w.writerows(ok_rows)

    with out_review.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "venue_id",
                "name",
                "city",
                "address_text",
                "google_maps_url",
                "query_used",
                "provider",
                "lat",
                "lon",
                "label",
                "reason",
            ],
        )
        w.writeheader()
        w.writerows(review_rows)

    print("\nGenerados:")
    print(" -", out_ok)
    print(" -", out_review)
    print("\nSiguiente paso: importa el OK en Supabase y ejecuta UPDATE (solo donde lat/lon están NULL).")


if __name__ == "__main__":
    main()

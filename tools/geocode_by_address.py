from __future__ import annotations

import argparse
import csv
import re
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import requests

# -----------------------------
# Config
# -----------------------------

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
PHOTON_URL = "https://photon.komoot.io/api/"

HEADERS = {
    "User-Agent": "advisoret-geocoder/1.1 (contact: pablo_penichet@yahoo.es)",
    "Accept-Language": "es",
}

# Viewbox (left,top,right,bottom). Sirve para "encapsular" el geocoding y que no se vaya a otra provincia.
VIEWBOX = {
    # Valencia ciudad (aprox)
    "valencia": "-0.431,39.563,-0.260,39.405",
    # Alicante ciudad (aprox)
    "alicante": "-0.563,38.407,-0.435,38.332",
}

# Bounds para sanity-check (lat_min, lat_max, lon_min, lon_max)
CITY_BOUNDS = {
    "valencia": (39.405, 39.563, -0.431, -0.260),
    "alicante": (38.332, 38.407, -0.563, -0.435),
}

# -----------------------------
# Helpers
# -----------------------------


def norm(s: str) -> str:
    s = (s or "").strip().lower()
    s = s.replace("à", "a").replace("á", "a").replace("ä", "a")
    s = s.replace("è", "e").replace("é", "e").replace("ë", "e")
    s = s.replace("ì", "i").replace("í", "i").replace("ï", "i")
    s = s.replace("ò", "o").replace("ó", "o").replace("ö", "o")
    s = s.replace("ù", "u").replace("ú", "u").replace("ü", "u")
    s = s.replace("ç", "c")
    return re.sub(r"\s+", " ", s)


def split_city_parts(city: str) -> list[str]:
    """
    Admite cosas como:
      - "Valencia"
      - "Borbotó (Valencia)"
      - "Alacant/Alicante" (si alguna vez apareciera)
    Devuelve una lista de tokens plausibles para "match" contra labels.
    """
    c = (city or "").strip()
    parts: list[str] = []
    if not c:
        return parts

    # Lo de dentro de paréntesis ayuda a validar labels (p.ej. "Borbotó (Valencia)")
    m = re.findall(r"\((.*?)\)", c)
    if m:
        parts.extend([p.strip() for p in m if p.strip()])

    # Y el "city base" sin paréntesis
    base = re.sub(r"\s*\(.*?\)\s*", " ", c).strip()
    if base:
        parts.append(base)

    # Split por separadores comunes
    out: list[str] = []
    for p in parts:
        out.extend([x.strip() for x in re.split(r"[/,-]", p) if x.strip()])

    # Quita duplicados manteniendo orden
    seen = set()
    final = []
    for p in out:
        n = norm(p)
        if n and n not in seen:
            seen.add(n)
            final.append(p)
    return final


def base_city(city: str) -> str:
    """
    Para construir query: si viene "Borbotó (Valencia)" devolvemos "Borbotó, Valencia"
    para ayudar al geocoding sin perder el ancla provincial.
    """
    c = (city or "").strip()
    if not c:
        return ""
    inners = re.findall(r"\((.*?)\)", c)
    outer = re.sub(r"\s*\(.*?\)\s*", " ", c).strip()
    if inners and outer:
        # "outer, inner"
        inner = inners[0].strip()
        if inner and inner.lower() not in outer.lower():
            return f"{outer}, {inner}"
    return outer or c


def province_hint(city: str) -> str:
    c = norm(city)
    if "valencia" in c or "valencia" in " ".join(split_city_parts(city)).lower():
        return "Valencia"
    if "alicante" in c or "alacant" in c or "alicante" in " ".join(split_city_parts(city)).lower():
        return "Alicante"
    if "castellon" in c or "castello" in c:
        return "Castellón"
    return ""


def clean_address(addr: str) -> str:
    s = (addr or "").strip()
    s = re.sub(r"\s+", " ", s)
    return s


def parse_gmaps_query(url: str) -> str:
    """
    Extrae el 'query=' de un google maps search url tipo:
      https://www.google.com/maps/search/?api=1&query=...
    """
    if not url:
        return ""
    try:
        u = urllib.parse.urlparse(url)
        qs = urllib.parse.parse_qs(u.query)
        q = (qs.get("query") or [""])[0]
        return urllib.parse.unquote_plus(q).strip()
    except Exception:
        return ""


def apply_city_viewbox(params: dict, city: str) -> None:
    """
    Aplica viewbox/bounded SOLO para Valencia/Alicante ciudad.
    Esto reduce muchísimo los falsos positivos de nombres genéricos.
    """
    c = norm(city)
    if c == "valencia":
        params["viewbox"] = VIEWBOX["valencia"]
        params["bounded"] = 1
    elif c == "alicante" or c == "alacant":
        params["viewbox"] = VIEWBOX["alicante"]
        params["bounded"] = 1


def in_city_bounds(city: str, lat: float, lon: float) -> bool:
    c = norm(city)
    if c not in CITY_BOUNDS:
        return True  # no restringimos otras ciudades
    lat_min, lat_max, lon_min, lon_max = CITY_BOUNDS[c]
    return (lat_min <= lat <= lat_max) and (lon_min <= lon <= lon_max)


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

    if r.status_code in (429, 403):
        raise RuntimeError(f"Nominatim HTTP {r.status_code}: {r.text[:120]}")

    r.raise_for_status()
    time.sleep(sleep_s)  # respeta Nominatim
    data = r.json()
    return data if isinstance(data, list) else []


def query_nominatim_freeform(q: str, city: str, sleep_s: float) -> Optional[Hit]:
    params = {
        "q": q,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
        "countrycodes": "es",
        "email": "pablo_penichet@yahoo.es",
    }
    apply_city_viewbox(params, city)
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
    apply_city_viewbox(params, city)
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
    if c:
        parts.append(c)
    if prov and prov.lower() not in (c or "").lower():
        parts.append(prov)
    parts.append("Comunitat Valenciana")
    parts.append("España")
    return ", ".join([p for p in parts if p])


def looks_plausible(city: str, label: str) -> bool:
    """
    Heurística suave: si Nominatim te da algo en ES pero sin ciudad clara,
    no lo tiramos automáticamente. Solo usamos esto como filtro de "alarmas".
    """
    if not label:
        return True

    label_n = norm(label)

    # Si el label menciona España/València/Alicante, mejor.
    # Y si el city tiene paréntesis, aceptamos cualquiera de sus partes.
    city_parts = split_city_parts(city)
    if not city_parts:
        return True

    for p in city_parts:
        pn = norm(p)
        if pn and pn in label_n:
            return True

    # fallback: provincia
    prov = province_hint(city)
    if prov and norm(prov) in label_n:
        return True

    return False


def try_geocode_freeform(q: str, city: str, sleep_s: float) -> Optional[Hit]:
    # Nominatim -> Photon
    try:
        h = query_nominatim_freeform(q, city, sleep_s)
    except Exception:
        h = None
    if h is not None:
        return h
    try:
        return query_photon(q)
    except Exception:
        return None


def split_street_number(address: str) -> tuple[str, str]:
    """
    Intenta separar "Calle X 12" en ("Calle X", "12").
    Suficiente para un structured search básico.
    """
    if not address:
        return "", ""
    m = re.search(r"^(.*?)[, ]+(\d+[A-Za-z]?)\b", address.strip())
    if not m:
        return "", ""
    street = m.group(1).strip()
    num = m.group(2).strip()
    return street, num


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="venues_need_coords.csv")
    ap.add_argument("--out_ok", default="venue_coords_OK.csv")
    ap.add_argument("--out_review", default="venue_coords_REVIEW.csv")
    ap.add_argument("--sleep", type=float, default=1.1, help="Sleep entre calls a Nominatim (>=1 recomendable)")
    args = ap.parse_args()

    in_path = Path(args.input)
    rows: list[dict] = []
    with in_path.open("r", encoding="utf-8", newline="") as f:
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
            queries.append((q_addr, "addr_first"))

            # Structured attempt si podemos separar calle + número
            street, num = split_street_number(addr)
            if street and num:
                queries.append((f"STRUCT::{street}::{num}", "nominatim_struct"))

        # 2) Si hay query en google maps: úsala
        if gmaps_q:
            queries.append((gmaps_q, "gmaps_query"))

        # 3) Por nombre + ciudad (fallback)
        queries.append((build_query(name, "", city), "name_city"))

        hit: Optional[Hit] = None
        used = ""
        provider = ""
        label = ""
        reason = ""

        for qq, why in queries:
            if qq.startswith("STRUCT::"):
                # Structured via Nominatim
                _, street, num = qq.split("::", 2)
                try:
                    h = query_nominatim_structured(street, num, city=base_c or city, sleep_s=args.sleep)
                except Exception:
                    h = None
                if h is not None:
                    hit = h
                    used = f"{street} {num}, {base_c or city}"
                    provider = h.provider
                    label = h.label
                    break
                continue

            h = try_geocode_freeform(qq, city=base_c or city, sleep_s=args.sleep)
            if h is not None:
                hit = h
                used = qq
                provider = h.provider
                label = h.label
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

        # Validaciones
        plausible = looks_plausible(city, label)
        bounds_ok = in_city_bounds(norm(base_c or city), hit.lat, hit.lon)

        if not plausible:
            reason = "label_mismatch_city"
        elif not bounds_ok and norm(base_c or city) in CITY_BOUNDS:
            reason = "bbox_outside_city"

        if reason:
            print(f"[{i}/{total}] REVIEW  {name} ({city}) -> {hit.lat:.6f},{hit.lon:.6f} [{provider}] ({reason})")
            review_rows.append(
                {
                    "venue_id": venue_id,
                    "name": name,
                    "city": city,
                    "address_text": addr,
                    "google_maps_url": gmaps_url,
                    "query_used": used,
                    "provider": provider,
                    "lat": hit.lat,
                    "lon": hit.lon,
                    "label": label,
                    "reason": reason,
                }
            )
            continue

        print(f"[{i}/{total}] OK      {name} ({city}) -> {hit.lat:.6f},{hit.lon:.6f} [{provider}]")
        ok_rows.append(
            {
                "venue_id": venue_id,
                "name": name,
                "city": city,
                "address_text": addr,
                "google_maps_url": gmaps_url,
                "query_used": used,
                "provider": provider,
                "lat": hit.lat,
                "lon": hit.lon,
                "label": label,
                "reason": "",
            }
        )

    # Write outputs
    ok_path = Path(args.out_ok)
    rev_path = Path(args.out_review)

    ok_fields = ["venue_id", "lat", "lon", "provider", "label", "query_used"]
    with ok_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=ok_fields)
        w.writeheader()
        for r in ok_rows:
            w.writerow({k: r.get(k, "") for k in ok_fields})

    rev_fields = [
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
    ]
    with rev_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rev_fields)
        w.writeheader()
        for r in review_rows:
            w.writerow({k: r.get(k, "") for k in rev_fields})

    print(f"\nOK: {len(ok_rows)} -> {ok_path}")
    print(f"REVIEW: {len(review_rows)} -> {rev_path}")


if __name__ == "__main__":
    main()

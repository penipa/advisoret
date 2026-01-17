from __future__ import annotations

import argparse
import csv
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

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


def looks_plausible(expected_city: str, haystack: str) -> bool:
    ec = norm(expected_city)
    hs = norm(haystack)
    if not ec:
        return True
    main = ec.split(" ")[0]
    return (ec in hs) or (main in hs)


@dataclass
class Hit:
    lat: float
    lon: float
    label: str
    provider: str


def query_nominatim(q: str) -> Optional[Hit]:
    params = {
        "q": q,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
        "countrycodes": "es",
        "email": "pablo_penichet@yahoo.es",
    }
    r = requests.get(NOMINATIM_URL, params=params, headers=HEADERS, timeout=25)
    if r.status_code != 200:
        raise RuntimeError(f"Nominatim HTTP {r.status_code}: {r.text[:120]}")
    data = r.json()
    if not data:
        return None
    it = data[0]
    return Hit(
        lat=float(it["lat"]),
        lon=float(it["lon"]),
        label=it.get("display_name", ""),
        provider="nominatim",
    )


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
        [
            str(props.get(k))
            for k in ("name", "street", "housenumber", "city", "state", "country")
            if props.get(k)
        ]
    )
    return Hit(lat=float(coords[1]), lon=float(coords[0]), label=label, provider="photon")


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

    # corta teléfonos y basura habitual
    a = re.split(r"·|\||\btel\.?\b|\btelf\.?\b|\btelefono\b|\bteléfono\b", a, flags=re.IGNORECASE)[0].strip()

    # abreviaturas frecuentes
    a = re.sub(r"\bC/\b", "Calle ", a, flags=re.IGNORECASE)
    a = re.sub(r"\bAvda\.?\b", "Avenida", a, flags=re.IGNORECASE)
    a = re.sub(r"\bAv\.?\b", "Avenida", a, flags=re.IGNORECASE)
    a = re.sub(r"\bPl\.?\b", "Plaza", a, flags=re.IGNORECASE)

    # quita sufijos que suelen liar al geocoder
    a = re.sub(r"\b(bajo|bloque|grupo|local|portal|piso|puerta)\b.*$", "", a, flags=re.IGNORECASE).strip()

    a = re.sub(r"\s+", " ", a).strip(" ,")
    return a


def build_query(name: str, address: str, city: str) -> str:
    c = base_city(city)
    prov = province_hint(city)
    parts = [name.strip()] if name.strip() else []
    if address and address.strip():
        parts.append(address.strip())
    if c:
        parts.append(c)
    if prov and prov.lower() not in c.lower():
        parts.append(prov)
    parts.append("España")
    return ", ".join([p for p in parts if p])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="venues_need_coords.csv")
    ap.add_argument("--out_ok", default="venue_coords_OK.csv")
    ap.add_argument("--out_review", default="venue_coords_REVIEW.csv")
    ap.add_argument("--sleep", type=float, default=1.3, help="segundos entre requests (Nominatim)")
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

    total = len(rows)
    ok_rows, review_rows = [], []

    # ✅ helper nuevo: aquí vive try_geocode
    def try_geocode(query: str) -> Optional[Hit]:
        # 1) Nominatim
        try:
            h = query_nominatim(query)
        except Exception:
            h = None
        finally:
            time.sleep(args.sleep)

        if h is not None:
            return h

        # 2) Photon
        try:
            return query_photon(query)
        except Exception:
            return None

    for i, row in enumerate(rows, start=1):
        venue_id = (row.get("venue_id") or "").strip()
        name = (row.get("name") or "").strip()
        city = (row.get("city") or "").strip()
        addr = clean_address(row.get("address_text") or "")

        prov = province_hint(city)
        bc = base_city(city)

        queries: list[tuple[str, str]] = []

        # 1) ✅ address-first (sin nombre)
        if addr:
            q_addr = ", ".join(
                [p for p in [addr, bc, prov if prov and prov.lower() not in bc.lower() else "", "España"] if p]
            )
            queries.append(("ADDR", q_addr))

        # 2) nombre + address
        queries.append(("FULL", build_query(name, addr, city)))

        # 3) nombre sin prefijo (Bar/Cafetería/…) + address
        alt = strip_generic_prefix(name)
        if alt and alt.lower() != name.lower():
            queries.append(("ALT", build_query(alt, addr, city)))

        # 4) nombre + ciudad (sin address)
        q_name_city = ", ".join(
            [p for p in [name, bc, prov if prov and prov.lower() not in bc.lower() else "", "España"] if p]
        )
        queries.append(("NAME_CITY", q_name_city))

        hit = None
        used = ""
        for tag, q in queries:
            used = f"{tag}:{q}"
            hit = try_geocode(q)
            if hit is not None:
                break

        if hit is None:
            print(f"[{i}/{total}] MISS {name} ({city}) -> sin resultado")
            review_rows.append(
                {
                    "venue_id": venue_id,
                    "name": name,
                    "city": city,
                    "address_text": addr,
                    "query": used,
                    "reason": "no_result",
                }
            )
            continue

        if looks_plausible(city, hit.label):
            print(f"[{i}/{total}] OK      {name} ({city}) -> {hit.lat:.7f}, {hit.lon:.7f} [{hit.provider}] | {hit.label[:90]}")
            ok_rows.append(
                {
                    "venue_id": venue_id,
                    "lat": hit.lat,
                    "lon": hit.lon,
                    "provider": hit.provider,
                    "label": hit.label,
                }
            )
        else:
            print(f"[{i}/{total}] SUSPECT {name} ({city}) -> {hit.lat:.7f}, {hit.lon:.7f} [{hit.provider}] | {hit.label[:90]}")
            review_rows.append(
                {
                    "venue_id": venue_id,
                    "name": name,
                    "city": city,
                    "address_text": addr,
                    "query": used,
                    "provider": hit.provider,
                    "lat": hit.lat,
                    "lon": hit.lon,
                    "label": hit.label,
                    "reason": "city_mismatch",
                }
            )

    with out_ok.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["venue_id", "lat", "lon", "provider", "label"])
        w.writeheader()
        w.writerows(ok_rows)

    with out_review.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["venue_id", "name", "city", "address_text", "query", "provider", "lat", "lon", "label", "reason"],
        )
        w.writeheader()
        w.writerows(review_rows)

    print("\nGenerados:")
    print(" -", out_ok)
    print(" -", out_review)


if __name__ == "__main__":
    main()

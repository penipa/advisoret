#!/usr/bin/env python3
"""Build the Comunitat Valenciana Overture pilot artifacts.

The input Parquet files are read with pyarrow. Geometry is GeoArrow WKB, so
this script deliberately implements the small Point/Polygon/MultiPolygon
subset needed for the supplied Overture divisions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import struct
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    import pyarrow.parquet as pq
except ImportError as exc:  # pragma: no cover - exercised in a clean install
    raise SystemExit("Este script requiere pyarrow (python3 -m pip install pyarrow).") from exc


RELEASE = "2026-09-23.1"
SCHEMA_VERSION = "v2.0.0"
PIPELINE_VERSION = "advisoret-overture-pilot-1"
REGION = "comunitat_valenciana"
REGION_GERS_ID = "084bbf4d-ae31-4b64-92c3-ca249b212185"
VALID_LOCAL_TYPES = {"city", "town", "village", "hamlet"}
UUID_RE = __import__("re").compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_MULTIPOLYGON_BBOXES: dict[int, list[tuple[Any, tuple[float, float, float, float]]]] = {}
_RING_INDEX: dict[int, dict[int, list[tuple[tuple[float, float], tuple[float, float]]]]] = {}
RING_BIN_SIZE = 0.01


def nonempty(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def local_type_values(value: Any) -> set[str]:
    if isinstance(value, dict):
        return {str(item).strip().lower() for item in value.values() if nonempty(item)}
    if isinstance(value, list):
        return {str(item[1]).strip().lower() for item in value if isinstance(item, (tuple, list)) and len(item) > 1 and nonempty(item[1])}
    return set()


def primary_name(value: Any) -> str | None:
    return nonempty(value.get("primary")) if isinstance(value, dict) else None


def read_u32(data: bytes, offset: int, endian: str) -> tuple[int, int]:
    return struct.unpack_from(endian + "I", data, offset)[0], offset + 4


def read_wkb(data: bytes, offset: int = 0) -> tuple[str, Any, int]:
    endian = "<" if data[offset] == 1 else ">"
    offset += 1
    raw_type, offset = read_u32(data, offset, endian)
    type_id = raw_type & 0x0FFFFFFF
    if type_id in (1001, 1002, 1003, 1004, 1005, 1006, 1007):
        type_id -= 1000
    if type_id in (1, 2, 3, 4, 5, 6, 7):
        pass
    else:
        raise ValueError(f"WKB geometry type no soportado: {raw_type}")
    if type_id == 1:
        x, y = struct.unpack_from(endian + "dd", data, offset)
        return "Point", (x, y), offset + 16
    count, offset = read_u32(data, offset, endian)
    if type_id == 2:
        points = []
        for _ in range(count):
            points.append(struct.unpack_from(endian + "dd", data, offset))
            offset += 16
        return "LineString", points, offset
    if type_id == 3:
        rings = []
        for _ in range(count):
            n, offset = read_u32(data, offset, endian)
            ring = []
            for _ in range(n):
                ring.append(struct.unpack_from(endian + "dd", data, offset))
                offset += 16
            rings.append(ring)
        return "Polygon", rings, offset
    if type_id in (4, 5, 6, 7):
        parts = []
        for _ in range(count):
            kind, value, offset = read_wkb(data, offset)
            parts.append((kind, value))
        return {4: "MultiPoint", 5: "MultiLineString", 6: "MultiPolygon", 7: "GeometryCollection"}[type_id], parts, offset
    raise ValueError(f"WKB geometry type no soportado: {raw_type}")


def geometry_bbox(geometry: tuple[str, Any]) -> tuple[float, float, float, float]:
    kind, value = geometry
    if kind == "Point":
        x, y = value
        return x, y, x, y
    points: list[tuple[float, float]] = []
    if kind == "Polygon":
        points = [point for ring in value for point in ring]
    elif kind == "MultiPolygon":
        points = [point for polygon_kind, polygon in value if polygon_kind == "Polygon" for ring in polygon for point in ring]
    else:
        raise ValueError(f"Geometría no poligonal inesperada: {kind}")
    xs, ys = zip(*points)
    return min(xs), min(ys), max(xs), max(ys)


def point_on_segment(point: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> bool:
    px, py = point
    ax, ay = a
    bx, by = b
    cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax)
    if abs(cross) > 1e-10:
        return False
    return min(ax, bx) - 1e-10 <= px <= max(ax, bx) + 1e-10 and min(ay, by) - 1e-10 <= py <= max(ay, by) + 1e-10


def point_in_ring(point: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    inside = False
    index = _RING_INDEX.get(id(ring))
    if index is None:
        index = {}
        for position, current in enumerate(ring):
            previous = ring[position - 1]
            low = math.floor(min(previous[1], current[1]) / RING_BIN_SIZE)
            high = math.floor(max(previous[1], current[1]) / RING_BIN_SIZE)
            for bucket in range(low, high + 1):
                index.setdefault(bucket, []).append((previous, current))
        _RING_INDEX[id(ring)] = index
    edges = index.get(math.floor(point[1] / RING_BIN_SIZE), ())
    for previous, current in edges:
        if point_on_segment(point, previous, current):
            return True
        x1, y1 = previous
        x2, y2 = current
        if (y1 > point[1]) != (y2 > point[1]):
            x_cross = (x2 - x1) * (point[1] - y1) / (y2 - y1) + x1
            if point[0] < x_cross:
                inside = not inside
    return inside


def point_in_polygon(point: tuple[float, float], polygon: list[list[tuple[float, float]]]) -> bool:
    return bool(polygon) and point_in_ring(point, polygon[0]) and not any(point_in_ring(point, ring) for ring in polygon[1:])


def point_in_geometry(point: tuple[float, float], geometry: tuple[str, Any]) -> bool:
    kind, value = geometry
    if kind == "Polygon":
        bbox = geometry_bbox(geometry)
        return bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3] and point_in_polygon(point, value)
    if kind == "MultiPolygon":
        parts = _MULTIPOLYGON_BBOXES.get(id(value))
        if parts is None:
            parts = []
            for polygon_kind, polygon in value:
                if polygon_kind == "Polygon" and polygon and polygon[0]:
                    parts.append((polygon, geometry_bbox((polygon_kind, polygon))))
            _MULTIPOLYGON_BBOXES[id(value)] = parts
        for polygon, bbox in parts:
            if bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3] and point_in_polygon(point, polygon):
                return True
        return False
    raise ValueError(f"Geometría regional no soportada: {kind}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--place", required=True, type=Path)
    parser.add_argument("--division", required=True, type=Path)
    parser.add_argument("--division-area", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--overwrite", action="store_true", help="permitir reemplazar exactamente el output indicado")
    parser.add_argument("--generated-at", help="timestamp UTC ISO-8601 para reproducibilidad")
    return parser.parse_args()


def compact_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def digest(path: Path) -> tuple[int, str]:
    data = path.read_bytes()
    return len(data), hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: Any) -> tuple[int, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(compact_bytes(value))
    return digest(path)


def load_divisions(path: Path) -> dict[str, tuple[str, str]]:
    table = pq.read_table(path, columns=["id", "names", "local_type"])
    divisions = {}
    for row in table.to_pylist():
        name = primary_name(row["names"])
        division_id = nonempty(row["id"])
        if division_id and name and local_type_values(row["local_type"]) & VALID_LOCAL_TYPES:
            divisions[division_id.lower()] = (name, division_id.lower())
    return divisions


def load_areas(path: Path, region_geometry: tuple[str, Any]) -> list[tuple[str, tuple[str, Any], tuple[float, float, float, float], str]]:
    table = pq.read_table(path, columns=["id", "geometry", "division_id"])
    areas = []
    for row in table.to_pylist():
        area_id = nonempty(row["id"])
        division_id = nonempty(row["division_id"])
        if not area_id or not division_id:
            continue
        geometry = read_wkb(row["geometry"])[0:2]
        bbox = geometry_bbox(geometry)
        if bbox[2] >= geometry_bbox(region_geometry)[0] and bbox[0] <= geometry_bbox(region_geometry)[2] and bbox[3] >= geometry_bbox(region_geometry)[1] and bbox[1] <= geometry_bbox(region_geometry)[3]:
            areas.append((area_id.lower(), geometry, bbox, division_id.lower()))
    return sorted(areas, key=lambda item: (item[3], item[0]))


def address_values(addresses: Any) -> tuple[str | None, str | None]:
    if not isinstance(addresses, list):
        return None, None
    locality_value = None
    freeform_value = None
    for address in addresses:
        if isinstance(address, dict):
            if locality_value is None:
                locality_value = nonempty(address.get("locality"))
            if freeform_value is None:
                freeform_value = nonempty(address.get("freeform"))
            if locality_value is not None and freeform_value is not None:
                break
    return locality_value, freeform_value


def main() -> None:
    args = parse_args()
    output = args.output
    if output.exists():
        if not args.overwrite:
            raise SystemExit(f"El output ya existe: {output}. Usa --overwrite explícitamente.")
        if not output.is_dir():
            raise SystemExit(f"--overwrite sólo admite un directorio de output: {output}")
        shutil.rmtree(output)
    output.mkdir(parents=True)

    region_table = pq.read_table(args.division_area, columns=["id", "geometry"])
    region_geometry = None
    for row in region_table.to_pylist():
        if str(row["id"]).lower() == REGION_GERS_ID:
            region_geometry = read_wkb(row["geometry"])[0:2]
            break
    if region_geometry is None:
        raise SystemExit(f"No se encontró el área regional {REGION_GERS_ID}")
    region_bbox = geometry_bbox(region_geometry)

    divisions = load_divisions(args.division)
    areas = load_areas(args.division_area, region_geometry)
    place_table = pq.read_table(args.place, columns=["id", "geometry", "confidence", "addresses", "names", "taxonomy"])

    food_count = confidence_count = missing_locality_count = enriched_count = 0
    records = []
    for row in place_table.to_pylist():
        geometry = read_wkb(row["geometry"])[0:2]
        if geometry[0] != "Point":
            continue
        point = geometry[1]
        if not (region_bbox[0] <= point[0] <= region_bbox[2] and region_bbox[1] <= point[1] <= region_bbox[3] and point_in_geometry(point, region_geometry)):
            continue
        taxonomy = row["taxonomy"] or {}
        hierarchy = taxonomy.get("hierarchy") or []
        if "food_and_drink" not in hierarchy:
            continue
        food_count += 1
        confidence = row["confidence"]
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(float(confidence))
            or confidence < 0.7
        ):
            continue
        confidence_count += 1
        name = primary_name(row["names"])
        identifier = nonempty(row["id"])
        if not name or not identifier:
            continue
        try:
            normalized_id = str(uuid.UUID(identifier)).lower()
        except (ValueError, AttributeError):
            continue
        locality, address = address_values(row["addresses"])
        city = locality
        if city is None:
            missing_locality_count += 1
            candidates = []
            for area_id, area_geometry, area_bbox, division_id in areas:
                if area_bbox[0] <= point[0] <= area_bbox[2] and area_bbox[1] <= point[1] <= area_bbox[3] and point_in_geometry(point, area_geometry) and division_id in divisions:
                    candidates.append((divisions[division_id][0], division_id, area_id))
            if candidates:
                city = sorted(candidates)[0][0]
                enriched_count += 1
        if city is None:
            continue
        records.append({"id": normalized_id, "name": name, "city": city, "address": address, "lat": point[1], "lon": point[0], "primary": nonempty(taxonomy.get("primary")), "confidence": float(confidence)})

    records.sort(key=lambda item: item["id"])
    final_records = [{key: record[key] for key in ("id", "name", "city", "address", "lat", "lon", "primary")} for record in records]
    public_dir = output / "public"
    private_dir = output / "private"
    search_path = public_dir / "search-index.json"
    search_size, search_sha = write_json(search_path, final_records)

    generated_at = args.generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    public_manifest = {"provider": "overture", "release": RELEASE, "schema_version": SCHEMA_VERSION, "pipeline_version": PIPELINE_VERSION, "generated_at": generated_at, "region": REGION, "record_count": len(final_records), "search_artifact": {"path": f"releases/{RELEASE}/{PIPELINE_VERSION}/{REGION}/search-index.json", "format": "json", "byte_size": search_size, "sha256": search_sha}}
    write_json(public_dir / "manifest.json", public_manifest)

    shard_records: dict[str, list[dict[str, Any]]] = {f"{number:02x}": [] for number in range(256)}
    for record in records:
        shard_records[record["id"][:2]].append(record)
    shard_manifest = {"release": RELEASE, "schema_version": SCHEMA_VERSION, "pipeline_version": PIPELINE_VERSION, "region": REGION, "record_count": len(records), "shards": {}}
    for shard_name in sorted(shard_records):
        shard_value = [{key: record[key] for key in ("id", "name", "city", "address", "lat", "lon", "primary", "confidence")} for record in shard_records[shard_name]]
        shard_path = private_dir / "shards" / f"{shard_name}.json"
        size, sha = write_json(shard_path, shard_value)
        shard_manifest["shards"][shard_name] = {"name": f"{shard_name}.json", "record_count": len(shard_value), "byte_size": size, "sha256": sha}
    write_json(private_dir / "manifest.json", shard_manifest)

    validate(output, records, final_records, search_size, search_sha)
    print(f"food_and_drink dentro del polígono regional: {food_count}")
    print(f"confidence >= 0.7: {confidence_count}")
    print(f"sin locality directa: {missing_locality_count}")
    print(f"enriquecidos con division/division_area local_type city|town|village|hamlet: {enriched_count}")
    print(f"unresolved excluidos: {missing_locality_count - enriched_count}")
    print(f"resultado final: {len(records)}")
    print(f"search-index byte_size: {search_size}")
    print(f"search-index sha256: {search_sha}")


def validate(output: Path, records: list[dict[str, Any]], public_records: list[dict[str, Any]], search_size: int, search_sha: str) -> None:
    expected = 25887
    if len(records) != expected:
        raise SystemExit(f"Validación fallida: resultado final {len(records)} != {expected}")
    ids = [record["id"] for record in records]
    if len(set(ids)) != len(ids) or any(not UUID_RE.fullmatch(identifier) or identifier != identifier.lower() for identifier in ids):
        raise SystemExit("Validación fallida: UUIDs no válidos o duplicados")
    if len(public_records) != expected or len(public_records) != len(ids):
        raise SystemExit("Validación fallida: search index")
    for record in records:
        if not record["name"].strip() or not record["city"].strip() or not (-90 <= record["lat"] <= 90) or not (-180 <= record["lon"] <= 180):
            raise SystemExit("Validación fallida: registro con campos inválidos")
    shard_dir = output / "private" / "shards"
    expected_shards = {f"{number:02x}" for number in range(256)}
    shard_files = sorted(shard_dir.glob("*.json"))
    actual_shards = {path.stem for path in shard_files}
    if actual_shards != expected_shards:
        raise SystemExit("Validación fallida: shards presentes distintos de 00..ff")
    private_manifest = json.loads((output / "private" / "manifest.json").read_text(encoding="utf-8"))
    shard_manifest = private_manifest.get("shards")
    if not isinstance(shard_manifest, dict) or set(shard_manifest) != expected_shards:
        raise SystemExit("Validación fallida: entradas del manifest de shards distintas de 00..ff")
    shard_count = 0
    for shard_name in sorted(expected_shards):
        shard_path = shard_dir / f"{shard_name}.json"
        shard_value = json.loads(shard_path.read_text(encoding="utf-8"))
        if not isinstance(shard_value, list):
            raise SystemExit(f"Validación fallida: shard {shard_name} no es una lista")
        entry = shard_manifest[shard_name]
        size, sha = digest(shard_path)
        if (
            entry.get("name") != f"{shard_name}.json"
            or entry.get("record_count") != len(shard_value)
            or entry.get("byte_size") != size
            or entry.get("sha256") != sha
        ):
            raise SystemExit(f"Validación fallida: manifest del shard {shard_name}")
        shard_count += len(shard_value)
    if private_manifest.get("record_count") != expected or shard_count != expected:
        raise SystemExit("Validación fallida: suma record_count de shards")
    manifest = json.loads((output / "public" / "manifest.json").read_text(encoding="utf-8"))
    size, sha = digest(output / "public" / "search-index.json")
    if size != search_size or sha != search_sha or manifest["search_artifact"]["byte_size"] != size or manifest["search_artifact"]["sha256"] != sha:
        raise SystemExit("Validación fallida: hash o tamaño del search index")


if __name__ == "__main__":
    main()

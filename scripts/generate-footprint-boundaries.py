# /// script
# requires-python = ">=3.11"
# dependencies = ["shapely==2.1.2", "pyshp==2.3.1"]
# ///
"""Rebuild the optional offline widget from checksummed public map releases."""

import argparse
import hashlib
import io
import json
import shutil
import sqlite3
import unicodedata
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile

import shapefile
from shapely import force_2d, from_wkb, make_valid, set_precision
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import unary_union


ROOT = Path(__file__).resolve().parents[1]
WIDGETS = Path("src/editor/widgets")
DATA = WIDGETS / "footprint-data"
ZENODO = "https://zenodo.org/api/records/22179207/files/"
NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/"
MACAU = "https://raw.githubusercontent.com/asdfghj1237890/mini-macau/73464205e99e782d8f1d9b0e8622ac3e681e3193/"
SOURCES = {
    "T2026_province.gpkg": (ZENODO + "T2026_province.gpkg/content", "bb4706a1999f45a1d8a82d4907f754515eb8628bf2bd489be23b4754e05aa681"),
    "T2026_prefecture.gpkg": (ZENODO + "T2026_prefecture.gpkg/content", "6a35915313444d4e669fdc147eade4eb50d67489c38c00f340d871baa624ad85"),
    "T2026_county.gpkg": (ZENODO + "T2026_county.gpkg/content", "4c7f4cfed6ff0bf96ed569ef3a653bc19506c4e95781349b201084349a19c980"),
    "T2025_county.gpkg": (ZENODO + "T2025_county.gpkg/content", "de54810cc397f3a38fed86ad0afd7b2fb1a01e7b5b0d5fc5331d6c1099220d90"),
    "ne_110m_admin_0_countries.geojson": (NE + "ne_110m_admin_0_countries.geojson", "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f"),
    "ne_10m_admin_1_states_provinces.zip": ("https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip", "efc59726337323058f9446210adc96673179cd344e053666ee3d28cb58ba2b05"),
    "parishes.json": (MACAU + "public/data/parishes.json", "e03146f80d98572c4b836aa07fdf29f3dc29143dcf9e92b22e508769ec64f41c"),
}
MUNICIPALITIES = {"110000", "120000", "310000", "500000"}
ARCHIVED = {"500105", "500112"}
WORLD_KEYS = {"CYN": "-99", "KOS": "OSA", "SAH": "ESH", "SOL": "ABV", "PSX": "PSE"}
# The saved IDs are Life Atlas' identifiers. Suffixes of HK-X**~ are not
# the same ordering; join named HASC districts and named OSM relations instead.
HK_DISTRICTS = [
    ("HK.CW", "中西区"), ("HK.WC", "湾仔区"), ("HK.EA", "东区"), ("HK.SO", "南区"),
    ("HK.YT", "油尖旺区"), ("HK.SS", "深水埗区"), ("HK.KC", "九龙城区"), ("HK.WT", "黄大仙区"),
    ("HK.KU", "观塘区"), ("HK.TW", "荃湾区"), ("HK.TM", "屯门区"), ("HK.YL", "元朗区"),
    ("HK.NO", "北区"), ("HK.TP", "大埔区"), ("HK.SK", "西贡区"), ("HK.ST", "沙田区"),
    ("HK.KI", "葵青区"), ("HK.IS", "离岛区"),
]
MACAU_DISTRICTS = [
    ("osm:r9506156", "花地玛堂区"), ("osm:r9506168", "花王堂区"), ("osm:r12107628", "望德堂区"),
    ("osm:r12107627", "大堂区"), ("osm:r12107629", "风顺堂区"), ("osm:r5758865", "嘉模堂区"),
    ("osm:r5758867", "路凼填海区"), ("osm:r5758866", "圣方济各堂区"),
]


def checked_inputs(cache):
    cache.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in SOURCES.items():
        path = cache / name
        if not path.exists():
            temporary = path.with_suffix(path.suffix + ".download")
            with urlopen(Request(url, headers={"User-Agent": "LifeAtlas-boundary-import/1.0"}), timeout=90) as res, temporary.open("wb") as out:
                shutil.copyfileobj(res, out)
            with temporary.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                    raise ValueError(f"Download differs from the pinned release: {name}")
            temporary.replace(path)
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                raise ValueError(f"Unexpected SHA-256 for {path}")


def polygons(geometry):
    if isinstance(geometry, Polygon):
        return [geometry] if not geometry.is_empty else []
    return [p for child in getattr(geometry, "geoms", []) for p in polygons(child)]


def compact(geometry, tolerance, precision):
    """Generalise WGS84 shapes; retain the largest land polygon at every size."""
    geometry = force_2d(geometry)
    if not geometry.is_valid:
        geometry = make_valid(geometry)
    parts = sorted(polygons(geometry), key=lambda p: p.area, reverse=True)
    if not parts:
        raise ValueError("Feature has no polygon")
    visible = [p for p in parts if p is parts[0] or p.area >= tolerance ** 2]
    cleaned = []
    for poly in visible:
        simplified = poly.simplify(tolerance, preserve_topology=True)
        rounded = set_precision(simplified, 10 ** -precision)
        cleaned.extend(polygons(rounded))
    if not cleaned:
        raise ValueError("Precision removed the entire feature")
    geom = cleaned[0] if len(cleaned) == 1 else MultiPolygon(cleaned)
    if not geom.is_valid:
        geom = unary_union(cleaned)
    return geom


def coordinate(pair, digits):
    # Use identical JSON numbers across Python revisions (and avoid -0.0).
    def scalar(value):
        rounded = round(value, digits)
        return int(rounded) if rounded.is_integer() else rounded
    return [scalar(value) for value in pair[:2]]


def geometry_json(geom, digits):
    def rings(poly):
        return [[coordinate(pt, digits) for pt in ring.coords] for ring in [poly.exterior, *poly.interiors]]
    parts = polygons(geom)
    return {"t": "P", "c": rings(parts[0])} if len(parts) == 1 else {"t": "M", "c": [rings(poly) for poly in parts]}


def encoded_geometry(raw, digits):
    # Polyline delta coding, longitude then latitude. Rounding happens once in
    # geometry_json; decode is lossless at that precision and needs no library.
    def ring(points):
        last = [0, 0]
        chars = []
        for p in points:
            for axis, value in enumerate(p):
                integer = round(value * 10 ** digits)
                delta = integer - last[axis]
                last[axis] = integer
                bits = (delta << 1) ^ (delta >> 31)
                while bits >= 32:
                    chars.append(chr((bits & 31) + 95))
                    bits >>= 5
                chars.append(chr(bits + 63))
        return "".join(chars)
    polygons_ = [raw["c"]] if raw["t"] == "P" else raw["c"]
    return {"p": digits, "rings": [ring(r) for poly in polygons_ for r in poly]}


def labels(geom, digits):
    anchor = max(polygons(geom), key=lambda p: p.area).representative_point()
    return coordinate(anchor.coords[0], digits)


def gpkg_rows(cache, table, columns, where="", args=()):
    source = (cache / (table + ".gpkg")).resolve().as_uri() + "?mode=ro"
    with sqlite3.connect(source, uri=True) as db:
        info = db.execute("SELECT column_name,srs_id FROM gpkg_geometry_columns WHERE table_name=?", (table,)).fetchone()
        if info != ("geom", 4326):
            raise ValueError(f"Expected WGS84 geometry in {table}: {info}")
        for *values, blob in db.execute(f'SELECT {columns},geom FROM "{table}" {where} ORDER BY fid', args):
            if blob[:2] != b"GP":
                raise ValueError("Invalid GeoPackage geometry")
            envelope = (blob[3] >> 1) & 7
            offset = 8 + (0, 32, 48, 48, 64)[envelope]
            yield [*values, from_wkb(blob[offset:])]


def city_feature(code, full, geometry, short_names, tolerance, digits):
    geom = compact(geometry, tolerance, digits)
    return {"id": "city-" + code, "adcode": code, "name": short_names.get(code, full),
            "full": full, "c": labels(geom, digits), "g": encoded_geometry(geometry_json(geom, digits), digits)}


def china(cache, display):
    province_rows, groups = [], {}
    for code, full, original in gpkg_rows(cache, "T2026_province", '"省级码","省"'):
        name = display["provinces"][code]
        geo = compact(original, 0.043 if code not in {"810000", "820000"} else 0.0008, 4)
        west, south, east, north = geo.bounds
        group_id = "cn-" + code
        groups[group_id] = {"provId": group_id, "provName": name, "bounds": [west, east, south, north], "cities": []}
        province_rows.append({"id": group_id, "name": name, "sub": full, "c": labels(geo, 4), "g": encoded_geometry(geometry_json(geo, 4), 4)})
    query = '"code","地名","省级码"'
    rows = gpkg_rows(cache, "T2026_prefecture", query)
    for code, full, prov, geom in rows:
        if code in MUNICIPALITIES | {"810000", "820000"}:
            continue
        groups["cn-" + prov]["cities"].append(city_feature(code, full, geom, display["china"], 0.03, 3))
    for code, full, prov, geom in gpkg_rows(cache, "T2026_county", query, 'WHERE "省级码" IN (?,?,?,?)', sorted(MUNICIPALITIES)):
        groups["cn-" + prov]["cities"].append(city_feature(code, full, geom, display["china"], 0.0025, 4))
    retired = []
    for code, full, prov, geom in gpkg_rows(cache, "T2025_county", query, 'WHERE code IN (?,?)', sorted(ARCHIVED)):
        feature = city_feature(code, full, geom, display["china"], 0.0025, 4)
        feature.update(provinceId="cn-" + prov, historicalYear=2025)
        retired.append(feature)
    if {x["adcode"] for x in retired} != ARCHIVED:
        raise ValueError("Missing archived districts")
    return province_rows, groups, retired


def natural_earth(cache, display, groups):
    world, japan, hong_kong, coverage = [], [], {}, None
    features = json.loads((cache / "ne_110m_admin_0_countries.geojson").read_text(encoding="utf8"))["features"]
    for f in features:
        p = f["properties"]
        code = p["ADM0_A3"]
        if code == "ATA":  # The existing travel world map stops north of Antarctica.
            continue
        key = WORLD_KEYS.get(code, code)
        name = display["world"].get(key, p["NAME_ZH"] or p["ADMIN"])
        sub = "West Bank" if key == "PSE" else p["ADMIN"]
        if key == "PSE":
            name = "约旦河西岸"  # The 110m feature has only the West Bank polygon.
        geom = compact(shape(f["geometry"]), 0.16, 3)
        raw = geometry_json(geom, 3)
        if code == "CHN":
            coverage = raw["c"] if raw["t"] == "M" else [raw["c"]]
        world.append({"id": "w-" + key, "name": name, "sub": sub, "c": labels(geom, 3), "g": encoded_geometry(raw, 3)})
    with ZipFile(cache / "ne_10m_admin_1_states_provinces.zip") as archive:
        stem = "ne_10m_admin_1_states_provinces"
        with shapefile.Reader(**{k: io.BytesIO(archive.read(stem + "." + k)) for k in ("shp", "shx", "dbf")}, encoding="utf8") as reader:
            for index, record in enumerate(reader.iterRecords(fields=["adm0_a3", "iso_3166_2", "code_hasc", "name"])):
                if record.adm0_a3 not in {"HKG", "JPN"}:
                    continue
                geom = shape(reader.shape(index).__geo_interface__)
                if record.adm0_a3 == "HKG":
                    hong_kong[record.code_hasc] = geom
                else:
                    code = str(int(record.iso_3166_2.split("-")[1]))
                    geom = compact(geom, 0.017, 3)
                    roman = "".join(ch for ch in unicodedata.normalize("NFD", record.name) if not unicodedata.combining(ch))
                    suffix = " Fu" if code in {"26", "27"} else " To" if code == "13" else " Ken"
                    sub = "Hokkai Do" if code == "1" else roman + suffix
                    japan.append({"id": "jp-" + code, "name": display["japan"][code], "sub": sub,
                                  "c": labels(geom, 3), "g": encoded_geometry(geometry_json(geom, 3), 3)})
    if set(hong_kong) != {code for code, _ in HK_DISTRICTS} or len(japan) != 47:
        raise ValueError("Unexpected Natural Earth district keys")
    for index, (code, full) in enumerate(HK_DISTRICTS, 1):
        groups["cn-810000"]["cities"].append(city_feature(f"810{index:03}", full, hong_kong[code], {}, 0.00065, 4))
    if not coverage:
        raise ValueError("Natural Earth CHN polygon missing")
    return sorted(world, key=lambda r: r["id"]), sorted(japan, key=lambda r: int(r["id"][3:])), coverage


def macau(cache):
    source = json.loads((cache / "parishes.json").read_text(encoding="utf8"))
    rows = {r["id"]: r for r in source["parishes"]}
    if set(rows) != {ident for ident, _ in MACAU_DISTRICTS}:
        raise ValueError("Unexpected Macau relations")
    geoms = {key: compact(shape({"type": "MultiPolygon", "coordinates": row["geometry"]}), 0.00008, 5)
             for key, row in rows.items()}
    # The Taipa parish and the separately mapped Cotai zone overlap in this
    # snapshot. Retain Cotai's observed outline, subtract that overlap from Taipa.
    geoms["osm:r5758865"] = geoms["osm:r5758865"].difference(geoms["osm:r5758867"])
    features = []
    for index, (relation, name) in enumerate(MACAU_DISTRICTS, 1):
        code = f"820{index:03}"
        geom = compact(geoms[relation], 0, 5)
        compacted = geometry_json(geom, 5)
        features.append({"type": "Feature", "id": "city-" + code,
                         "properties": {"adcode": code, "name": name, "osmRelation": int(relation[5:]), "kind": rows[relation]["kind"], "point": labels(geom, 5)},
                         "geometry": {"type": "Polygon" if compacted["t"] == "P" else "MultiPolygon", "coordinates": compacted["c"]}})
    return {"type": "FeatureCollection", "attribution": "© OpenStreetMap contributors", "license": "https://opendatacommons.org/licenses/odbl/1-0/",
            "sourceDate": source["fetchedAtUtc"], "features": features}


def packed(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def main():
    opts = argparse.ArgumentParser(description=__doc__)
    opts.add_argument("--cache-dir", type=Path, required=True, help="Folder for the verified public source downloads")
    opts.add_argument("--output-root", type=Path, default=ROOT, help="Root of the output tree, e.g. a scratch directory for comparison")
    args = opts.parse_args()
    checked_inputs(args.cache_dir)
    display = json.loads((ROOT / "scripts/footprint-display-names.json").read_text(encoding="utf8"))
    provinces, regions, retired = china(args.cache_dir, display)
    world, japan, coverage = natural_earth(args.cache_dir, display, regions)
    osm = macau(args.cache_dir)
    for prov in regions.values():
        prov["cities"].sort(key=lambda v: v["adcode"])
    header = "// Generated by scripts/generate-footprint-boundaries.py. See market/official/travel-footprint/SOURCES.md.\n"
    files = {
        DATA / "geoData.js": header + "".join(f"export const {key} = {packed(value)};\n" for key, value in
                                             [("REAL_GEO_WORLD", world), ("REAL_GEO_CHINA", provinces), ("REAL_GEO_JAPAN", japan)]),
        DATA / "chinaCitiesData.js": header + f"export const REAL_CHINA_CITIES_BY_PROV = {packed(regions)};\nexport const HISTORICAL_CHINA_DISTRICTS = {packed(retired)};\n",
        DATA / "macau-parishes.json": packed(osm) + "\n",
        WIDGETS / "trip-data/amap-coverage.json": packed(coverage) + "\n",
    }
    for relative, data in files.items():
        dest = args.output_root / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(data, encoding="utf8", newline="\n")
        print(f"{relative.as_posix()}: {dest.stat().st_size:,} bytes")
    print(f"{sum(len(p['cities']) for p in regions.values()) + len(osm['features'])} current Chinese regions, "
          f"{len(retired)} historic districts, {len(provinces)} provinces, {len(japan)} Japanese and {len(world)} world regions")


if __name__ == "__main__":
    main()

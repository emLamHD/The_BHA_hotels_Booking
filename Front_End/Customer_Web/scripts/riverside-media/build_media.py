#!/usr/bin/env python3
"""
CUST-WEB-SHOWCASE-001-CP02: builds the web derivatives of The BHA Riverside photographs
and the manifest that ties every published file to its original, its owner (Property or
RoomType) and its alt text.

    python3 build_media.py            # needs Pillow with WebP support
    SOURCE_DIR=/path/to/originals python3 build_media.py

Originals are read, never changed. Derivatives go to ../../public/media/the-bha-riverside/
(max 1600 px on the long edge, never upscaled, EXIF/XMP stripped, converted to sRGB) and the
manifest to ./manifest.json (kept out of public/ because it lists original file names).

Provenance evidence and gate: every original is scanned (byte search plus EXIF Software) before
anything is published, and the result is recorded per file in the manifest. This is a heuristic scan,
NOT a validation: no C2PA signature is verified (validation status NOT_RUN) and nothing here proves a
file is, or is not, a photograph of the real room. What it records:

  generator-markers-present   a marker that names a generative-image service was found
  content-credentials-detected  only a generic C2PA/JUMBF container marker (capture or edit; not AI by itself)
  editor-metadata-present     Lightroom/Photoshop/EXIF Software metadata; camera origin NOT independently verified
  no-metadata                 nothing to go on

Only editor-metadata-present files may be published, so the selection below is the list of photos the
Owner supplied for those rooms, at that evidence level. Files with generator markers or without
metadata are not published; widening that is an Owner decision, not a script flag.
"""
import hashlib
import io
import json
import os
import sys

from PIL import Image, ImageCms, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "public", "media", "the-bha-riverside"))
MANIFEST = os.path.join(HERE, "manifest.json")
SOURCE = os.environ.get(
    "SOURCE_DIR",
    "/home/admin1/The_BHA_assets/BHA_riverside_real_image/BHA đã Resize (bộ ảnh chính)",
)
MAX_EDGE = 1600
QUALITY = 80

GENERATOR_MARKERS = (b"trainedAlgorithmicMedia", b"gpt-image", b"OpenAI Media Service")
CREDENTIAL_MARKERS = (b"c2pa", b"caBX", b"jumb")
EDITOR_MARKERS = (b"Adobe Lightroom", b"Photoshop")
PUBLISHABLE = "editor-metadata-present"

# (source group, source file, derivative name, owner, order, cover, alt text in Vietnamese)
# owner: ("property", "the-bha-riverside") or ("room-type", "<room type code>").
# Alt text says only what is visible; no amenity or room claim beyond the picture.
SELECTION = [
    ("Các khu vực khác", "san2.JPG", "entrance-logo", ("property", "the-bha-riverside"), 0, True,
     "Cửa kính lối vào có biển hiệu The BHA Riverside và hai ghế thư giãn"),
    ("Các khu vực khác", "IMG_7182.JPG", "rooftop-pool-day", ("property", "the-bha-riverside"), 1, False,
     "Hồ bơi trên sân thượng vào ban ngày"),
    ("Các khu vực khác", "IMG_7178.JPG", "rooftop-pool-night", ("property", "the-bha-riverside"), 2, False,
     "Hồ bơi trên sân thượng về đêm"),
    ("Các khu vực khác", "IMG_7181.JPG", "rooftop-pool-seating", ("property", "the-bha-riverside"), 3, False,
     "Hồ bơi và khu bàn ghế ngồi trên sân thượng"),
    ("Các khu vực khác", "IMG_7180.JPG", "rooftop-pool-city-view", ("property", "the-bha-riverside"), 4, False,
     "Hồ bơi sân thượng nhìn ra toàn cảnh khu dân cư"),
    ("Các khu vực khác", "IMG_7184.JPG", "rooftop-pool-mural", ("property", "the-bha-riverside"), 5, False,
     "Hồ bơi sân thượng với bức tranh tường và phao cứu sinh"),
    ("Sảnh", "sanh13.JPG", "lobby-sofa", ("property", "the-bha-riverside"), 6, False,
     "Khu ghế sofa và bàn trà trong sảnh"),
    ("Sảnh", "sanh12.JPG", "lobby-logo-clocks", ("property", "the-bha-riverside"), 7, False,
     "Logo The BHA Riverside và ba đồng hồ giờ quốc tế trên tường sảnh"),
    ("Sảnh", "sanh14.JPG", "lobby-shelves", ("property", "the-bha-riverside"), 8, False,
     "Kệ sách và bàn ăn nhỏ trong sảnh"),
    ("Các khu vực khác", "san1.JPG", "entrance-chairs", ("property", "the-bha-riverside"), 9, False,
     "Lối vào có cây xanh và bộ bàn ghế trước cửa kính"),
    ("Căn hộ 2PN", "2pnbcv2.JPG", "two-bedroom-balcony-view", ("room-type", "RIV-2BR"), 0, True,
     "Ban công căn hộ hai phòng ngủ nhìn ra thành phố"),
    ("Căn hộ 2PN", "view 3.JPG", "two-bedroom-skyline-1", ("room-type", "RIV-2BR"), 1, False,
     "Khung cảnh khu dân cư nhìn từ trên cao"),
    ("Căn hộ 2PN", "view1.JPG", "two-bedroom-skyline-2", ("room-type", "RIV-2BR"), 2, False,
     "Toàn cảnh khu dân cư và đồi núi phía xa nhìn từ trên cao"),
]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def scan(data: bytes, software: str | None) -> dict:
    """Heuristic evidence for one file. Pure function of the bytes and the EXIF Software tag."""
    generator = [m.decode() for m in GENERATOR_MARKERS if m in data]
    credentials = [m.decode() for m in CREDENTIAL_MARKERS if m in data]
    editor = [m.decode() for m in EDITOR_MARKERS if m in data]
    if generator:
        classification = "generator-markers-present"
    elif credentials:
        classification = "content-credentials-detected"
    elif editor or software:
        classification = PUBLISHABLE
    else:
        classification = "no-metadata"
    return {
        "classification": classification,
        "markers": generator + credentials + editor,
        "editorSoftware": software or None,
        "validation": "NOT_RUN",  # no C2PA signature validator was run
    }


NOTES = {
    "generator-markers-present": "markers naming a generative-image service were found; signature not validated, so this is an indication to verify, not proof",
    "content-credentials-detected": "a generic C2PA/JUMBF container marker was found; it records capture or edits and is not evidence of AI by itself; signature not validated",
    "editor-metadata-present": "editor/camera-software metadata present; camera origin and the depicted scene are not independently verified; no content-credential or generator marker found",
    "no-metadata": "no editor metadata and no content credentials (for example re-encoded by a messaging app); nothing to verify",
}


def to_srgb(image: Image.Image) -> Image.Image:
    icc = image.info.get("icc_profile")
    if not icc:
        return image.convert("RGB")
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        srgb = ImageCms.createProfile("sRGB")
        return ImageCms.profileToProfile(image.convert("RGB"), source, srgb, outputMode="RGB")
    except Exception:  # an unreadable profile: keep the pixels, assume sRGB
        return image.convert("RGB")


def main() -> int:
    if not os.path.isdir(SOURCE):
        print(f"SOURCE_DIR not found: {SOURCE}", file=sys.stderr)
        return 2
    os.makedirs(OUT_DIR, exist_ok=True)

    audit = {}
    for group in sorted(os.listdir(SOURCE)):
        for name in sorted(os.listdir(os.path.join(SOURCE, group))):
            path = os.path.join(SOURCE, group, name)
            data = open(path, "rb").read()
            with Image.open(path) as image:
                audit[(group, name)] = {
                    "group": group, "file": name, "sha256": sha256(data), "bytes": len(data),
                    "width": image.width, "height": image.height, **scan(data, image.getexif().get(305)),
                }

    published, selected = [], set()
    for group, name, derivative, owner, order, cover, alt in SELECTION:
        record = audit.get((group, name))
        if record is None:
            print(f"selected original not found: {group}/{name}", file=sys.stderr)
            return 2
        if record["classification"] != PUBLISHABLE:
            print(f"REFUSED {group}/{name}: {record['classification']} ({NOTES[record['classification']]})", file=sys.stderr)
            return 3
        selected.add((group, name))
        with Image.open(os.path.join(SOURCE, group, name)) as image:
            image = to_srgb(ImageOps.exif_transpose(image))
            scale = min(1.0, MAX_EDGE / max(image.size))
            if scale < 1.0:
                image = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
            target = os.path.join(OUT_DIR, derivative + ".webp")
            image.save(target, "WEBP", quality=QUALITY, method=6)  # no exif/xmp/icc passed: stripped
        out = open(target, "rb").read()
        with Image.open(target) as check:
            width, height = check.size
        published.append({
            "sourceGroup": group, "sourceFile": name, "sourceSha256": record["sha256"],
            "evidence": {k: record[k] for k in ("classification", "markers", "editorSoftware", "validation")},
            "evidenceNote": NOTES[record["classification"]],
            "derivative": derivative + ".webp", "width": width, "height": height, "bytes": len(out), "sha256": sha256(out),
            "ownerType": owner[0], "ownerCode": owner[1], "sortOrder": order, "isCover": cover, "altText": alt,
        })

    excluded = []
    for key, record in audit.items():
        if key in selected:
            continue
        if record["classification"] == PUBLISHABLE:
            reason = "not selected: not a picture of a room or area the demo needs (duplicate, close-up or redundant)"
        else:
            reason = "not published: " + NOTES[record["classification"]]
        excluded.append({k: record[k] for k in ("group", "file", "sha256", "bytes", "width", "height", "classification", "markers", "editorSoftware", "validation")} | {"reason": reason})

    manifest = {
        "schema": 2,
        "urlPath": "/media/the-bha-riverside/",
        "maxEdge": MAX_EDGE,
        "webpQuality": QUALITY,
        "evidenceLevel": "heuristic scan only; no C2PA signature validator was run (validation NOT_RUN)",
        "originalsAudited": len(audit),
        "originalsPublished": len(published),
        "originalsByClassification": {kind: sum(1 for r in audit.values() if r["classification"] == kind) for kind in NOTES},
        "published": published,
        "excluded": sorted(excluded, key=lambda r: (r["group"], r["file"])),
    }
    with open(MANIFEST, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    total = sum(p["bytes"] for p in published)
    print(f"audited {len(audit)} originals: {manifest['originalsByClassification']}")
    print(f"published {len(published)} derivatives, {total} bytes -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

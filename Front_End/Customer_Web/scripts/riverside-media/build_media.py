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

Provenance gate: every original is audited before anything is published. A file whose
embedded content credentials say it was created by an image-generation model (C2PA, e.g.
OpenAI gpt-image, digitalSourceType trainedAlgorithmicMedia) is EXCLUDED, and a file may be
published only when it carries camera/editor metadata. The decision is recorded per file in
the manifest. Publishing synthetic images as photographs of real rooms would mislead
guests, so this gate is deliberate; widening it is an Owner decision, not a script flag.
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

AI_MARKERS = (b"c2pa", b"caBX", b"trainedAlgorithmicMedia", b"gpt-image", b"OpenAI Media Service")
CAMERA_MARKERS = (b"Adobe Lightroom", b"Photoshop")

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


def provenance(data: bytes, image: Image.Image) -> tuple[str, str]:
    """('ai' | 'camera' | 'unverified', human-readable reason)."""
    if any(marker in data for marker in AI_MARKERS):
        return "ai", "content credentials (C2PA) signed by an image-generation service: OpenAI gpt-image, trainedAlgorithmicMedia"
    software = image.getexif().get(305)
    if any(marker in data for marker in CAMERA_MARKERS) or software:
        return "camera", f"photo editor/camera metadata present ({software or 'Adobe Lightroom/Photoshop XMP'}); no AI credentials"
    return "unverified", "no camera metadata and no AI credentials (re-encoded by a messaging app); cannot be verified"


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
                kind, reason = provenance(data, image)
                audit[(group, name)] = {
                    "group": group, "file": name, "sha256": sha256(data), "bytes": len(data),
                    "width": image.width, "height": image.height, "provenance": kind, "provenanceReason": reason,
                }

    published, selected = [], set()
    for group, name, derivative, owner, order, cover, alt in SELECTION:
        record = audit.get((group, name))
        if record is None:
            print(f"selected original not found: {group}/{name}", file=sys.stderr)
            return 2
        if record["provenance"] != "camera":
            print(f"REFUSED {group}/{name}: provenance is {record['provenance']} ({record['provenanceReason']})", file=sys.stderr)
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
            "provenance": record["provenanceReason"],
            "derivative": derivative + ".webp", "width": width, "height": height, "bytes": len(out), "sha256": sha256(out),
            "ownerType": owner[0], "ownerCode": owner[1], "sortOrder": order, "isCover": cover, "altText": alt,
        })

    excluded = []
    for key, record in audit.items():
        if key in selected:
            continue
        if record["provenance"] == "ai":
            reason = "excluded: " + record["provenanceReason"]
        elif record["provenance"] == "unverified":
            reason = "excluded: " + record["provenanceReason"]
        else:
            reason = "not selected: camera photo kept out of the demo (duplicate, redundant or not needed)"
        excluded.append({k: record[k] for k in ("group", "file", "sha256", "bytes", "width", "height", "provenance")} | {"reason": reason})

    manifest = {
        "schema": 1,
        "urlPath": "/media/the-bha-riverside/",
        "maxEdge": MAX_EDGE,
        "webpQuality": QUALITY,
        "originalsAudited": len(audit),
        "originalsPublished": len(published),
        "originalsByProvenance": {kind: sum(1 for r in audit.values() if r["provenance"] == kind) for kind in ("camera", "ai", "unverified")},
        "published": published,
        "excluded": sorted(excluded, key=lambda r: (r["group"], r["file"])),
    }
    with open(MANIFEST, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    total = sum(p["bytes"] for p in published)
    print(f"audited {len(audit)} originals: {manifest['originalsByProvenance']}")
    print(f"published {len(published)} derivatives, {total} bytes -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

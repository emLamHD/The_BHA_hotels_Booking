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

Provenance evidence: every original is scanned (byte search plus EXIF Software) and the result is
recorded per file in the manifest. This is a heuristic scan, NOT a validation: no C2PA signature is
verified (validation status NOT_RUN) and nothing here proves a file is, or is not, a photograph of the
real room. What it records:

  generator-markers-present   a marker that names a generative-image service was found
  content-credentials-detected  only a generic C2PA/JUMBF container marker (capture or edit; not AI by itself)
  editor-metadata-present     Lightroom/Photoshop/EXIF Software metadata; camera origin NOT independently verified
  no-metadata                 nothing to go on

Publication is decided by the SELECTION list below, i.e. by the Owner: the Owner sorted the originals into
one folder per room type and, on 2026-10-08, authorized publishing the pictures of those folders in the
demo whatever the scan says (the earlier rule that only editor-metadata files could be published is
lifted). The manifest keeps the scan result next to the decision, so an Owner-authorized file with
generator markers or no metadata is recorded as exactly that: "owner-authorized", provenance
UNVERIFIED — never as a verified photograph.
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
    # C3: the balcony view is no longer the cover; the room's interior is (see LinkMigrations in the catalog).
    ("Căn hộ 2PN", "2pnbcv2.JPG", "two-bedroom-balcony-view", ("room-type", "RIV-2BR"), 6, False,
     "Ban công căn hộ hai phòng ngủ nhìn ra thành phố"),
    ("Căn hộ 2PN", "view 3.JPG", "two-bedroom-skyline-1", ("room-type", "RIV-2BR"), 7, False,
     "Khung cảnh khu dân cư nhìn từ trên cao"),
    ("Căn hộ 2PN", "view1.JPG", "two-bedroom-skyline-2", ("room-type", "RIV-2BR"), 8, False,
     "Toàn cảnh khu dân cư và đồi núi phía xa nhìn từ trên cao"),
    # ---- CP02-C3 (Owner-authorized): interior pictures for every room type, appended so the earlier
    # ---- entries keep their position (the catalog derives stable media ids from the position).
    ("Căn hộ 1PN", "pk1.png", "one-bedroom-living", ("room-type", "RIV-1BR"), 0, True,
     "Phòng khách có ghế sofa và bàn trà, phía sau là giường ngủ"),
    ("Căn hộ 1PN", "pn1.png", "one-bedroom-bedroom-1", ("room-type", "RIV-1BR"), 1, False,
     "Phòng ngủ với giường đôi, tủ quần áo và tranh treo tường"),
    ("Căn hộ 1PN", "pn2.png", "one-bedroom-bedroom-2", ("room-type", "RIV-1BR"), 2, False,
     "Phòng ngủ nhìn về phía cửa kính ra ban công"),
    ("Căn hộ 1PN", "bepchung2.png", "one-bedroom-kitchen", ("room-type", "RIV-1BR"), 3, False,
     "Khu bếp nhỏ có bồn rửa, bếp và máy giặt"),
    ("Căn hộ 1PN", "nvs1.1.png", "one-bedroom-bathroom", ("room-type", "RIV-1BR"), 4, False,
     "Phòng tắm có bồn rửa, bồn cầu và buồng tắm kính"),
    ("Căn hộ 1PN", "bc1.png", "one-bedroom-balcony", ("room-type", "RIV-1BR"), 5, False,
     "Ban công hẹp có bàn cao và nhìn thấy phòng ngủ phía sau"),
    ("Căn hộ 1PN view thoáng", "pkv2.png", "open-view-living", ("room-type", "RIV-1BR-OPEN"), 0, True,
     "Phòng khách có ghế sofa, bàn ăn nhỏ và giường ngủ phía sau cửa kính"),
    ("Căn hộ 1PN view thoáng", "pkv4.png", "open-view-living-dining", ("room-type", "RIV-1BR-OPEN"), 1, False,
     "Phòng khách với sofa, bàn ăn, tivi và tủ lạnh"),
    ("Căn hộ 1PN view thoáng", "pnv11.png", "open-view-bedroom-balcony", ("room-type", "RIV-1BR-OPEN"), 2, False,
     "Phòng ngủ có cửa kính mở ra ban công nhìn cây xanh"),
    ("Căn hộ 1PN view thoáng", "pnv10.png", "open-view-bedroom", ("room-type", "RIV-1BR-OPEN"), 3, False,
     "Phòng ngủ với giường đôi, tủ quần áo và rèm trắng"),
    ("Căn hộ 1PN view thoáng", "pkv8.png", "open-view-balcony", ("room-type", "RIV-1BR-OPEN"), 4, False,
     "Ban công nhìn ra hàng cây và khu dân cư"),
    ("Căn hộ 1PN view thoáng", "nvs1.2.png", "open-view-bathroom", ("room-type", "RIV-1BR-OPEN"), 5, False,
     "Phòng tắm có vòi sen, bồn rửa và bồn cầu"),
    ("Căn hộ 2PN", "2pnkhach2.png", "two-bedroom-living", ("room-type", "RIV-2BR"), 0, True,
     "Phòng khách có ghế sofa, bàn trà và tivi"),
    ("Căn hộ 2PN", "2pnv1.png", "two-bedroom-bedroom-1", ("room-type", "RIV-2BR"), 1, False,
     "Phòng ngủ thứ nhất với giường đôi và tủ quần áo"),
    ("Căn hộ 2PN", "2pnv2.png", "two-bedroom-bedroom-2", ("room-type", "RIV-2BR"), 2, False,
     "Phòng ngủ có cửa kính ra ban công"),
    ("Căn hộ 2PN", "2pnvnight2.png", "two-bedroom-bedroom-night", ("room-type", "RIV-2BR"), 3, False,
     "Phòng ngủ về đêm nhìn ra ánh đèn thành phố"),
    ("Căn hộ 2PN", "2pnv5.png", "two-bedroom-bedroom-tv", ("room-type", "RIV-2BR"), 4, False,
     "Phòng ngủ có tivi treo tường và cửa sổ"),
    ("Căn hộ 2PN", "nvs2pn.png", "two-bedroom-bathroom", ("room-type", "RIV-2BR"), 5, False,
     "Phòng tắm có vòi sen, bồn rửa và bồn cầu"),
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


def decision_for(classification: str) -> str:
    """Why a file is published. Never a claim about what the picture is."""
    if classification == PUBLISHABLE:
        return "owner-selected (editor metadata present; camera origin not independently verified)"
    return "owner-authorized 2026-10-08 (scan: " + classification + "; provenance unverified)"


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

    published, selected, published_hashes = [], set(), set()
    for group, name, derivative, owner, order, cover, alt in SELECTION:
        record = audit.get((group, name))
        if record is None:
            print(f"selected original not found: {group}/{name}", file=sys.stderr)
            return 2
        if record["sha256"] in published_hashes:
            print(f"REFUSED {group}/{name}: the same original is already published under another name", file=sys.stderr)
            return 3
        published_hashes.add(record["sha256"])
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
            "decision": decision_for(record["classification"]),
            "provenanceStatus": "UNVERIFIED",
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
        "publicationPolicy": "SELECTION is the Owner's: pictures of the folders the Owner sorted per room type are published; Owner authorization (2026-10-08) covers files whose scan shows generator markers or no metadata. Provenance of every published file is UNVERIFIED.",
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

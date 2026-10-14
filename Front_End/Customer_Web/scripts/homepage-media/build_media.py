#!/usr/bin/env python3
"""
CUST-WEB-001-CP08a-C2: fetches the licensed Wikimedia Commons photographs used by the booking-portal
home page and builds their web derivatives plus the manifest (`manifest.json`). The credits shown on the
`/media-credits` page live in `src/data/heroSlides.ts`; `heroSlides.test.ts` checks them against this manifest.

    python3 -I build_media.py            # needs Pillow with WebP support and curl; touches only the files listed below

Only the files in SELECTION are requested, one call each to the Commons API (licence, author, original
checksum) and one to the 2400 px rendition Commons renders for the file. Originals of the Riverside
photographs (public/media/the-bha-riverside) are never touched. Derivatives: EXIF/XMP stripped, sRGB,
WebP, never upscaled. A licence that is not one of ALLOWED_LICENSES stops the build, so a file whose
page changes licence is not published silently.
"""
import hashlib
import io
import json
import os
import subprocess
import sys
import time
import urllib.parse
from datetime import date

from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "public", "media", "the-bha-travel"))
MANIFEST = os.path.join(HERE, "manifest.json")
UA = "BHA-Booking-media-build/1.0 (https://github.com/emLamHD/The_BHA_hotels_Booking)"
ALLOWED_LICENSES = {"CC0", "CC BY 2.0", "CC BY 4.0", "CC BY-SA 2.0", "CC BY-SA 4.0"}
QUALITY = 78
HERO_QUALITY = 68
RENDITION_WIDTH = 2400

HERO = (1920, 900)
CARD = (1200, 800)

# id, Commons title, derivatives [(file, (w, h), (focus_x, focus_y), alt)]
SELECTION = [
    (
        "dragon-bridge-dusk",
        "File:Da Nang, Vietnam.jpg",
        [
            ("hero-dragon-bridge-dusk.webp", HERO, (0.5, 0.55), "Cầu Rồng và sông Hàn lúc hoàng hôn, Đà Nẵng"),
            ("card-cau-rong-song-han.webp", CARD, (0.42, 0.62), "Cầu Rồng bắc qua sông Hàn lúc hoàng hôn, Đà Nẵng"),
        ],
    ),
    (
        "danang-skyline-night",
        "File:Bright Da Nang skyline (Unsplash).jpg",
        [
            ("hero-danang-skyline.webp", HERO, (0.5, 0.5), "Đường chân trời Đà Nẵng lúc chạng vạng"),
            ("card-danang-skyline.webp", CARD, (0.5, 0.55), "Đường chân trời Đà Nẵng lúc chạng vạng"),
        ],
    ),
    ("han-river-bridge-night", "File:Da Nang - DaNang1492.jpg", [("hero-han-river-night.webp", HERO, (0.5, 0.5), "Cầu quay sông Hàn về đêm, Đà Nẵng")]),
    (
        "my-khe-beach",
        "File:My Khe Beach, Da Nang, Vietnam.jpg",
        [
            ("hero-my-khe-beach.webp", HERO, (0.5, 0.55), "Bãi biển Mỹ Khê với hàng dừa, Đà Nẵng"),
            ("card-my-khe-beach.webp", CARD, (0.5, 0.5), "Bãi biển Mỹ Khê với hàng dừa, Đà Nẵng"),
        ],
    ),
    ("linh-ung-pagoda", "File:Chùa Linh Ứng Buddhist Temple, Danang, Vietnam (54161781835).jpg", [("card-linh-ung-son-tra.webp", CARD, (0.5, 0.5), "Chùa Linh Ứng trên bán đảo Sơn Trà, Đà Nẵng")]),
    ("marble-mountains-view", "File:Da Nang - coastal view from Marble Mountains Mar 2024 01.jpg", [("card-ngu-hanh-son.webp", CARD, (0.5, 0.5), "Nhìn ra bờ biển từ Ngũ Hành Sơn, Đà Nẵng")]),
    ("hoi-an-old-town-night", "File:2024-12-20 Hoi An Old Town at night 4.jpg", [("card-hoi-an.webp", CARD, (0.5, 0.5), "Phố cổ Hội An về đêm với đèn lồng")]),
    ("hue-citadel-gate", "File:Gate in the Citadel of Huế.jpg", [("card-hue.webp", CARD, (0.5, 0.45), "Cổng trong Kinh thành Huế")]),
    ("danang-fireworks", "File:Audience impressed by Danang International Firework Festival.jpg", [("card-firework-festival.webp", CARD, (0.5, 0.5), "Khán giả xem Lễ hội pháo hoa quốc tế Đà Nẵng")]),
]


def curl(url, retries=5):
    for attempt in range(retries):
        out = subprocess.run(["curl", "-sS", "-L", "-m", "90", "-A", UA, url], capture_output=True)
        if out.returncode == 0 and out.stdout and out.stdout[:1] not in (b"<", b"{") :
            return out.stdout
        time.sleep(3 + attempt * 3)
    raise RuntimeError("download failed: " + url)


def api(title):
    params = {
        "action": "query", "format": "json", "titles": title, "prop": "imageinfo",
        "iiprop": "url|size|sha1|extmetadata", "iiurlwidth": RENDITION_WIDTH,
    }
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    for attempt in range(5):
        out = subprocess.run(["curl", "-sS", "-m", "60", "-A", UA, url], capture_output=True, text=True).stdout
        try:
            page = list(json.loads(out)["query"]["pages"].values())[0]
            return page["imageinfo"][0], page["title"]
        except Exception:
            time.sleep(3 + attempt * 3)
    raise RuntimeError("API failed: " + title)


def plain(meta, key):
    import re
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", meta.get(key, {}).get("value", "") or "")).strip()


def crop(image, size, focus):
    target_w, target_h = size
    scale = max(target_w / image.width, target_h / image.height)
    if scale > 1:
        raise RuntimeError("rendition too small for " + str(size))
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.LANCZOS)
    left = min(max(round(resized.width * focus[0] - target_w / 2), 0), resized.width - target_w)
    top = min(max(round(resized.height * focus[1] - target_h / 2), 0), resized.height - target_h)
    return resized.crop((left, top, left + target_w, top + target_h)), (left, top, left + target_w, top + target_h), resized.size


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    entries = []
    for ident, title, derivatives in SELECTION:
        info, canonical = api(title)
        meta = info["extmetadata"]
        license_name = plain(meta, "LicenseShortName")
        if license_name not in ALLOWED_LICENSES:
            sys.exit("licence not allowed for %s: %r" % (title, license_name))
        data = curl(info["thumburl"])
        rendition_sha = hashlib.sha256(data).hexdigest()
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        outputs = []
        for file_name, size, focus, alt in derivatives:
            cropped, box, resized = crop(image, size, focus)
            buffer = io.BytesIO()
            cropped.save(buffer, "WEBP", quality=HERO_QUALITY if size == HERO else QUALITY, method=6)
            path = os.path.join(OUT_DIR, file_name)
            with open(path, "wb") as handle:
                handle.write(buffer.getvalue())
            outputs.append({
                "file": file_name, "width": size[0], "height": size[1], "bytes": len(buffer.getvalue()),
                "sha256": hashlib.sha256(buffer.getvalue()).hexdigest(), "alt": alt,
                "crop": {"focus": list(focus), "box": list(box), "scaledTo": list(resized)},
            })
        entries.append({
            "id": ident,
            "commonsTitle": canonical,
            "sourceUrl": "https://commons.wikimedia.org/wiki/" + canonical.replace(" ", "_"),
            "author": plain(meta, "Artist"),
            "license": license_name,
            "licenseUrl": plain(meta, "LicenseUrl").replace("http://", "https://"),
            "attributionRequired": plain(meta, "AttributionRequired") == "true",
            "originalDimensions": [info["width"], info["height"]],
            "originalSha1": info["sha1"],
            "renditionWidth": RENDITION_WIDTH,
            "renditionSha256": rendition_sha,
            "retrievedOn": date.today().isoformat(),
            "derivatives": outputs,
        })
        print(ident, license_name, [o["file"] + " " + str(o["bytes"]) for o in outputs])
    manifest = {"schema": 1, "urlPath": "/media/the-bha-travel/", "webpQuality": {"card": QUALITY, "hero": HERO_QUALITY}, "entries": entries}
    with open(MANIFEST, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()

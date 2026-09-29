#!/usr/bin/env python3
"""Apply one authorized GitHub issue-form request to a QUBLY gallery."""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

from optimize_images import ROOT, sizes_for


MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 50_000_000
ASSET_DIR = ROOT / "assets" / "optimized" / "PS" / "managed"
CATEGORIES = ("esterni", "interni", "paesaggi")
ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")


def form_values(body: str) -> dict[str, str]:
    sections = re.split(r"(?m)^### ([^\r\n]+)\r?\n", body)
    values = {}
    for index in range(1, len(sections), 2):
        value = sections[index + 1].strip()
        values[sections[index].strip()] = "" if value in {"_No response_", "No response"} else value
    return values


def clean_title(value: str) -> str:
    value = " ".join(value.split())
    if len(value) > 90 or any(ord(char) < 32 for char in value):
        raise ValueError("Il titolo deve avere al massimo 90 caratteri e stare su una riga.")
    return value


def attachment_url(value: str) -> str:
    links = re.findall(r"https://[^\s)>\"']+", value)
    allowed = []
    for link in links:
        parsed = urllib.parse.urlparse(link.rstrip(".,"))
        if parsed.hostname == "github.com" and parsed.path.startswith("/user-attachments/assets/"):
            allowed.append(link.rstrip(".,"))
        elif parsed.hostname == "user-images.githubusercontent.com":
            allowed.append(link.rstrip(".,"))
    if len(allowed) != 1 or len(links) != 1:
        raise ValueError("Allega esattamente una immagine PNG, JPG o WebP nel modulo GitHub.")
    return allowed[0]


def download_image(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "QUBLY-gallery-manager/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("L'immagine supera il limite di 10 MB di GitHub.")
    return data


def image_variants(gallery_id: str, data: bytes) -> tuple[int, int, str, list[tuple[int, str]]]:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(data).hexdigest()[:10]
    with Image.open(io.BytesIO(data)) as opened:
        if opened.format not in {"JPEG", "PNG", "WEBP"} or getattr(opened, "n_frames", 1) != 1:
            raise ValueError("Il file deve essere una singola immagine PNG, JPG o WebP.")
        image = ImageOps.exif_transpose(opened)
        if image.width < 640 or image.height < 400 or image.width * image.height > MAX_PIXELS:
            raise ValueError("Usa un'immagine di almeno 640 × 400 px e non oltre 50 megapixel.")
        if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
            background = Image.new("RGB", image.size, "#0a0a0a")
            background.paste(image.convert("RGBA"), mask=image.convert("RGBA").getchannel("A"))
            image = background
        else:
            image = image.convert("RGB")
        if image.width > 1920:
            image = image.resize((1920, round(image.height * 1920 / image.width)), Image.Resampling.LANCZOS)
        width, height = image.size
        variants = []
        for target_width in sorted({min(width, value) for value in (640, 1280, 1920)}):
            rendered = image if target_width == width else image.resize(
                (target_width, round(height * target_width / width)), Image.Resampling.LANCZOS
            )
            filename = f"{gallery_id}-{target_width}.webp"
            rendered.save(ASSET_DIR / filename, "WEBP", quality=87 if target_width == width else 84, method=6)
            variants.append((target_width, f"assets/optimized/PS/managed/{filename}?v={digest}"))
    return width, height, digest, variants


def title_from_item(item: str, language: str) -> str:
    match = re.search(rf'data-caption-{language}="([^"]*)"', item)
    return html.unescape(match.group(1)) if match else ""


def render_item(
    gallery_id: str, category: str, titles: tuple[str, str, str],
    width: int, height: int, variants: list[tuple[int, str]],
    classes: str, eager: bool, total_items: int,
) -> str:
    italian, english, slovenian = [html.escape(title, quote=True) for title in titles]
    srcset = ", ".join(f"{url} {variant_width}w" for variant_width, url in variants)
    full = variants[-1][1]
    loading = 'loading="eager" fetchpriority="high"' if eager else 'loading="lazy"'
    return (
        f'                <a href="{full}" class="{classes}" data-gallery-id="{gallery_id}" '
        f'data-gallery-managed="true" data-pswp-width="{width}" data-pswp-height="{height}">\n'
        f'                    <img src="{full}" width="{width}" height="{height}" '
        f'srcset="{srcset}" sizes="{sizes_for(total_items)}" alt="{italian}" {loading} decoding="async" />\n'
        f'                    <span class="masonry-caption" aria-hidden="true"><span class="masonry-caption__title" '
        f'data-caption-it="{italian}" data-caption-en="{english}" data-caption-sl="{slovenian}">{italian}</span></span>\n'
        f'                </a>'
    )


def locate_item(gallery_id: str) -> tuple[str, str, re.Match[str]]:
    matches = []
    for category in CATEGORIES:
        page = (ROOT / f"{category}.html").read_text(encoding="utf-8")
        pattern = re.compile(
            rf'<a\b[^>]*data-gallery-id="{re.escape(gallery_id)}"[^>]*>.*?</a>', re.DOTALL
        )
        match = pattern.search(page)
        if match:
            matches.append((category, page, match))
    if len(matches) != 1:
        raise ValueError("ID foto non trovato o non univoco. Sceglilo dal catalogo visivo aggiornato.")
    return matches[0]


def update_sizes(page: str) -> str:
    total = len(re.findall(r'class="masonry-item(?:\s|\")', page))
    target = sizes_for(total)
    start = page.index('<div class="masonry-gallery')
    end = page.index('</div>', start)
    gallery = re.sub(r'sizes="[^"]+"', f'sizes="{target}"', page[start:end])
    return page[:start] + gallery + page[end:]


def apply_request(event: dict, image_data: bytes) -> tuple[str, str]:
    issue = event["issue"]
    title = issue["title"]
    values = form_values(issue.get("body") or "")
    number = int(issue["number"])

    if title.startswith("[Aggiungi foto]"):
        category = values.get("Sezione", "").strip().lower()
        if category not in CATEGORIES:
            raise ValueError("Seleziona Esterni, Interni o Paesaggi.")
        gallery_id = f"nuova-{number}"
        if any(gallery_id in (ROOT / f"{name}.html").read_text(encoding="utf-8") for name in CATEGORIES):
            raise ValueError("Questa richiesta è già stata applicata.")
        italian = clean_title(values.get("Titolo italiano", ""))
        if not italian:
            raise ValueError("Il titolo italiano è obbligatorio per una nuova foto.")
        english = clean_title(values.get("Titolo inglese", "")) or italian
        slovenian = clean_title(values.get("Titolo sloveno", "")) or italian
        page_path = ROOT / f"{category}.html"
        page = page_path.read_text(encoding="utf-8")
        total = page.count('data-gallery-id="') + 1
        width, height, _, variants = image_variants(gallery_id, image_data)
        rendered = render_item(
            gallery_id, category, (italian, english, slovenian), width, height,
            variants, "masonry-item is-managed", total <= 2, total,
        )
        marker = "                <!-- MANAGED-GALLERY:END -->"
        if page.count(marker) != 1:
            raise ValueError("Blocco delle nuove immagini non trovato.")
        page = page.replace(marker, rendered + "\n" + marker)
    elif title.startswith("[Sostituisci foto]"):
        gallery_id = values.get("ID foto", "").strip().lower()
        if not ID_PATTERN.fullmatch(gallery_id):
            raise ValueError("ID foto non valido. Apri la richiesta dal catalogo visivo.")
        category, page, match = locate_item(gallery_id)
        old = match.group(0)
        italian = clean_title(values.get("Titolo italiano", ""))
        if italian:
            english = clean_title(values.get("Titolo inglese", "")) or italian
            slovenian = clean_title(values.get("Titolo sloveno", "")) or italian
        else:
            italian = title_from_item(old, "it")
            english = title_from_item(old, "en") or italian
            slovenian = title_from_item(old, "sl") or italian
        if not italian:
            raise ValueError("La foto da sostituire non ha un titolo leggibile.")
        classes = re.search(r'class="([^"]+)"', old).group(1)
        if "is-managed" not in classes:
            classes += " is-managed"
        total = page.count('data-gallery-id="')
        index = page[:match.start()].count('data-gallery-id="')
        width, height, _, variants = image_variants(gallery_id, image_data)
        rendered = render_item(
            gallery_id, category, (italian, english, slovenian), width, height,
            variants, classes, index < 2, total,
        )
        page = page[:match.start()] + rendered + page[match.end():]
    else:
        raise ValueError("Usa uno dei due moduli GitHub per le gallerie.")

    page = update_sizes(page)
    (ROOT / f"{category}.html").write_text(page, encoding="utf-8", newline="")
    return category, gallery_id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", type=Path, required=True, help="GitHub event JSON")
    parser.add_argument("--image-file", type=Path, help="Local fixture for testing only")
    args = parser.parse_args()
    event = json.loads(args.event.read_text(encoding="utf-8"))
    issue = event["issue"]
    values = form_values(issue.get("body") or "")
    if args.image_file:
        image_data = args.image_file.read_bytes()
    else:
        url = attachment_url(values.get("Nuova immagine", ""))
        image_data = download_image(url)
    category, gallery_id = apply_request(event, image_data)
    print(f"Aggiornata {category}: {gallery_id}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Keep the visual catalog and the published gallery order in sync."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = ("esterni", "interni", "paesaggi")
CATALOG_PATH = ROOT / "gallery" / "catalog.json"
ITEM_PATTERN = re.compile(r'(?m)^[ \t]*<a\b[^>]*\bdata-gallery-id="[^"]+"[^>]*>.*?^[ \t]*</a>', re.DOTALL)
ID_PATTERN = re.compile(r'data-gallery-id="([^"]+)"')
GALLERY_PATTERN = re.compile(r'(?P<open><div class="masonry-gallery[^>]*>)(?P<content>.*?)(?P<close>\n[ \t]*</div>)', re.DOTALL)


def gallery_parts(page: str) -> tuple[re.Match[str], str]:
    match = GALLERY_PATTERN.search(page)
    if not match:
        raise ValueError("Griglia della galleria non trovata")
    return match, match.group("content")


def item_blocks(page: str) -> dict[str, str]:
    _, content = gallery_parts(page)
    result = {}
    for match in ITEM_PATTERN.finditer(content):
        block = match.group(0).strip()
        gallery_id = ID_PATTERN.search(block).group(1)
        if gallery_id in result:
            raise ValueError(f"Foto duplicata: {gallery_id}")
        result[gallery_id] = block
    return result


def item_data(gallery_id: str, block: str) -> dict:
    titles = {}
    for language in ("it", "en", "sl"):
        match = re.search(rf'data-caption-{language}="([^"]*)"', block)
        titles[language] = html.unescape(match.group(1)) if match else ""
    image = re.search(r'<img\b[^>]*\bsrc="([^"]+)"', block)
    return {"id": gallery_id, "titles": titles, "preview": html.unescape(image.group(1)) if image else ""}


def read_catalog() -> dict:
    if CATALOG_PATH.exists():
        catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        if catalog.get("version") != 1 or set(catalog.get("sections", {})) != set(CATEGORIES):
            raise ValueError("Catalogo non valido")
        return catalog
    return {"version": 1, "sections": {category: [] for category in CATEGORIES}}


def refresh_catalog() -> dict:
    """Read current HTML metadata, retaining the chosen order of known photos."""
    catalog = read_catalog()
    for category in CATEGORIES:
        page = (ROOT / f"{category}.html").read_text(encoding="utf-8")
        blocks = item_blocks(page)
        old_order = [item["id"] for item in catalog["sections"][category]]
        order = [gallery_id for gallery_id in old_order if gallery_id in blocks]
        order.extend(gallery_id for gallery_id in blocks if gallery_id not in order)
        catalog["sections"][category] = [item_data(gallery_id, blocks[gallery_id]) for gallery_id in order]
    CATALOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CATALOG_PATH.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return catalog


def replace_items(page: str, blocks: dict[str, str], order: list[str]) -> str:
    if len(order) != len(blocks) or set(order) != set(blocks):
        raise ValueError("L'ordine deve contenere ogni foto della sezione una volta sola")
    match, _ = gallery_parts(page)
    line_ending = "\r\n" if "\r\n" in page else "\n"

    def prioritized(block: str, position: int) -> str:
        def update_image(image_match: re.Match[str]) -> str:
            image = re.sub(r'\s(?:loading|fetchpriority)="[^"]*"', "", image_match.group(0))
            priority = ' loading="eager" fetchpriority="high"' if position == 0 else ' loading="eager"' if position == 1 else ' loading="lazy"'
            return image.replace(" />", f"{priority} />") if image.endswith(" />") else image[:-1] + priority + ">"
        return re.sub(r'<img\b[^>]*>', update_image, block, count=1)

    content = (
        "\n                <!-- GALLERY-ITEMS:START -->\n"
        + "\n".join("                " + prioritized(blocks[gallery_id], index).replace("\r\n", "\n").replace("\r", "\n") for index, gallery_id in enumerate(order))
        + "\n                <!-- GALLERY-ITEMS:END -->"
    ).replace("\n", line_ending)
    return page[:match.start("content")] + content + page[match.end("content"):]


def sync_pages(catalog: dict | None = None) -> None:
    catalog = catalog or read_catalog()
    for category in CATEGORIES:
        path = ROOT / f"{category}.html"
        with path.open("r", encoding="utf-8", newline="") as handle:
            page = handle.read()
        blocks = item_blocks(page)
        order = [item["id"] for item in catalog["sections"][category]]
        updated = replace_items(page, blocks, order)
        with path.open("w", encoding="utf-8", newline="") as handle:
            handle.write(updated)


if __name__ == "__main__":
    sync_pages(refresh_catalog())

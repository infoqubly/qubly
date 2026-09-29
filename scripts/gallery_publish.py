#!/usr/bin/env python3
"""Publish photos uploaded from QUBLY Tools, then apply the catalog order."""

from __future__ import annotations

import json
import re
from pathlib import Path

import gallery_catalog
import gallery_request
from optimize_images import read_document, write_document


ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "gallery" / "inbox"
REQUEST_NAME = re.compile(r"[0-9a-f]{32}\.json\Z")
IMAGE_TYPES = {"jpg", "jpeg", "png", "webp"}


def publish_request(request_path: Path) -> None:
    if request_path.parent != INBOX or not REQUEST_NAME.fullmatch(request_path.name):
        raise ValueError("Richiesta foto non valida")
    request = json.loads(request_path.read_text(encoding="utf-8"))
    mode = request.get("mode")
    category = request.get("category")
    extension = request.get("extension")
    titles = request.get("titles")
    if mode not in {"add", "replace"} or category not in gallery_catalog.CATEGORIES:
        raise ValueError("Operazione o sezione non valida")
    if extension not in IMAGE_TYPES or not isinstance(titles, dict):
        raise ValueError("File o titoli non validi")
    clean_titles = tuple(gallery_request.clean_title(titles.get(language, "")) for language in ("it", "en", "sl"))
    if any(not title for title in clean_titles):
        raise ValueError("Scrivi i tre titoli per pubblicare la foto")
    image_path = request_path.with_suffix("." + extension)
    data = image_path.read_bytes()
    if len(data) > gallery_request.MAX_UPLOAD_BYTES:
        raise ValueError("Immagine troppo grande")

    if mode == "add":
        gallery_id = "photo-" + request_path.stem
        path = ROOT / f"{category}.html"
        page = read_document(path)
        blocks = gallery_catalog.item_blocks(page)
        if gallery_id in blocks:
            raise ValueError("Questa foto è già stata pubblicata")
        classes = "masonry-item is-managed"
        index = len(blocks)
    else:
        gallery_id = request.get("id", "")
        if not gallery_request.ID_PATTERN.fullmatch(gallery_id):
            raise ValueError("Foto da sostituire non valida")
        found_category, page, match = gallery_request.locate_item(gallery_id)
        if found_category != category:
            raise ValueError("La foto non appartiene alla sezione selezionata")
        path = ROOT / f"{category}.html"
        blocks = gallery_catalog.item_blocks(page)
        old = match.group(0)
        classes = re.search(r'class="([^"]+)"', old).group(1)
        if "is-managed" not in classes:
            classes += " is-managed"
        index = list(blocks).index(gallery_id)

    width, height, _, variants = gallery_request.image_variants(gallery_id, data)
    total = len(blocks) + (mode == "add")
    blocks[gallery_id] = gallery_request.render_item(
        gallery_id, category, clean_titles, width, height, variants,
        classes, index < 2, total,
    )
    page = gallery_catalog.replace_items(page, blocks, list(blocks))
    page = gallery_request.update_sizes(page)
    write_document(path, page)
    request_path.unlink()
    image_path.unlink()


def main() -> None:
    requests = sorted(INBOX.glob("*.json")) if INBOX.exists() else []
    for request_path in requests:
        publish_request(request_path)
    catalog = gallery_catalog.refresh_catalog() if requests else gallery_catalog.read_catalog()
    gallery_catalog.sync_pages(catalog)
    print(f"Gallerie aggiornate: {len(requests)} foto, ordine pubblicato")


if __name__ == "__main__":
    main()

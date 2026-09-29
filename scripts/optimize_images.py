#!/usr/bin/env python3
"""Generate responsive WebP images and keep QUBLY galleries in sync.

Sources of truth:
- PS/esterni, PS/interni, PS/paesaggi: numbered JPG/JPEG/PNG files.
- PS/P*.png and PS/S*.png: homepage problem/solution images.

The generated files in assets/optimized/PS must not be edited by hand.
"""

from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
PS_DIR = ROOT / "PS"
OPTIMIZED_DIR = ROOT / "assets" / "optimized" / "PS"
TARGET_WIDTHS = (640, 1280, 1920)
WEBP_QUALITY = 82


@dataclass(frozen=True)
class ResponsiveImage:
    key: str
    source_path: Path
    source_url: str
    width: int
    height: int
    digest: str
    variants: tuple[tuple[int, str], ...]


CATEGORIES = {
    "esterni": {
        "page": "esterni.html",
        "default_alt": "Render esterno QUBLY",
        "wide_positions": {1, 4, 7},
        "full_positions": set(),
    },
    "interni": {
        "page": "interni.html",
        "default_alt": "Render interno QUBLY",
        "wide_positions": {2, 5, 9},
        "full_positions": set(),
    },
    "paesaggi": {
        "page": "paesaggi.html",
        "default_alt": "Render paesaggio QUBLY",
        "wide_positions": {3, 8},
        "full_positions": {1},
    },
}

SOURCE_PRIORITY = {".jpg": 0, ".jpeg": 1, ".png": 2}
ROOT_SOURCE_PRIORITY = {".png": 0, ".jpg": 1, ".jpeg": 2}


def read_document(path: Path) -> str:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return handle.read()


def write_document(path: Path, content: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        handle.write(content)


def version_for(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def source_files(directory: Path, pattern: re.Pattern[str], priority: dict[str, int]) -> list[Path]:
    selected: dict[str, Path] = {}
    for path in directory.iterdir():
        if not path.is_file() or path.suffix.lower() not in priority:
            continue
        if not pattern.fullmatch(path.stem):
            continue
        current = selected.get(path.stem)
        if current is None or priority[path.suffix.lower()] < priority[current.suffix.lower()]:
            selected[path.stem] = path

    def natural_key(path: Path) -> tuple[int, int | str]:
        if path.stem.isdigit():
            return (0, int(path.stem))
        return (1, path.stem)

    return sorted(selected.values(), key=natural_key)


def webp_mode(image: Image.Image) -> Image.Image:
    if image.mode in {"RGBA", "LA"} or "transparency" in image.info:
        return image.convert("RGBA")
    return image.convert("RGB")


def generate_variants(source: Path, output_dir: Path, url_dir: str) -> ResponsiveImage:
    output_dir.mkdir(parents=True, exist_ok=True)
    digest = version_for(source)

    with Image.open(source) as opened:
        transposed = ImageOps.exif_transpose(opened)
        prepared = webp_mode(transposed)
        original_width, original_height = prepared.size

        widths = sorted({min(original_width, requested) for requested in TARGET_WIDTHS})
        variants: list[tuple[int, str]] = []
        expected_files: set[Path] = set()

        for width in widths:
            height = max(1, round(original_height * width / original_width))
            rendered = prepared if width == original_width else prepared.resize(
                (width, height), Image.Resampling.LANCZOS
            )
            output_name = f"{source.stem}-{width}.webp"
            output_path = output_dir / output_name
            save_options = {
                "format": "WEBP",
                "quality": WEBP_QUALITY,
                "method": 6,
                "exact": True,
            }
            icc_profile = opened.info.get("icc_profile")
            if icc_profile:
                save_options["icc_profile"] = icc_profile
            rendered.save(output_path, **save_options)
            expected_files.add(output_path)
            variants.append((width, f"{url_dir}/{output_name}"))

    stale_pattern = re.compile(rf"^{re.escape(source.stem)}-\d+\.webp$", re.IGNORECASE)
    for existing in output_dir.iterdir():
        if existing.is_file() and stale_pattern.fullmatch(existing.name) and existing not in expected_files:
            existing.unlink()

    return ResponsiveImage(
        key=source.stem,
        source_path=source,
        source_url=source.relative_to(ROOT).as_posix(),
        width=original_width,
        height=original_height,
        digest=digest,
        variants=tuple(variants),
    )


def existing_alt_texts(page: str, category: str) -> dict[str, str]:
    pattern = re.compile(
        rf'<a\s+href="PS/{re.escape(category)}/(?P<key>[^"?/.]+)\.[^"?]+[^>]*>.*?'
        rf'<img\b[^>]*\balt="(?P<alt>[^"]*)"',
        re.DOTALL,
    )
    return {match.group("key"): html.unescape(match.group("alt")) for match in pattern.finditer(page)}


def sizes_for(total_items: int) -> str:
    """Match the compact gallery's responsive column count."""
    mobile = "44vw" if total_items >= 10 else "90vw"
    tablet = "29vw" if total_items >= 10 else "43vw"
    desktop = "215px" if total_items >= 17 else "265px" if total_items >= 10 else "360px"
    return f"(max-width: 767px) {mobile}, (max-width: 1024px) {tablet}, {desktop}"


def variant_attributes(image: ResponsiveImage) -> tuple[str, str]:
    srcset = ", ".join(
        f"{url}?v={image.digest} {width}w" for width, url in image.variants
    )
    fallback = f"{image.variants[-1][1]}?v={image.digest}"
    return fallback, srcset


def gallery_item(
    image: ResponsiveImage, category: str, position: int, alt_text: str,
    caption: str, total_items: int, preceding_items: int,
) -> str:
    fallback, srcset = variant_attributes(image)
    source = f"{image.source_url}?v={image.digest}"
    alt = html.escape(alt_text, quote=True)
    eager = preceding_items + position <= 2
    loading = 'loading="eager" fetchpriority="high"' if eager else 'loading="lazy"'
    sizes = sizes_for(total_items)
    gallery_id = f"{category}-{image.key}"
    return (
        f'                <a href="{source}" target="_blank" rel="noopener" class="masonry-item" '
        f'data-gallery-id="{gallery_id}" data-pswp-width="{image.width}" data-pswp-height="{image.height}">\n'
        f'                    <img src="{fallback}" width="{image.width}" height="{image.height}" '
        f'srcset="{srcset}" sizes="{sizes}" alt="{alt}" {loading} decoding="async" />\n'
        f'                    {caption}\n'
        f"                </a>"
    )


def existing_gallery_items(page: str, category: str) -> dict[str, str]:
    start = page.index("<!-- AUTO-GALLERY:START -->")
    end = page.index("<!-- AUTO-GALLERY:END -->", start)
    content = page[start:end]
    items: dict[str, str] = {}
    for match in re.finditer(r"(?m)^[ \t]*<a\b[^>]*>.*?^[ \t]*</a>", content, re.DOTALL):
        block = match.group(0).strip()
        key = re.search(r'data-gallery-id="([^"]+)"', block)
        if key:
            items[key.group(1)] = block
    return items


def existing_caption(block: str, alt_text: str) -> str:
    match = re.search(r'<span class="masonry-caption"[^>]*>.*?</span></span>', block, re.DOTALL)
    if match:
        return match.group(0)
    title = html.escape(alt_text, quote=True)
    return (
        '<span class="masonry-caption" aria-hidden="true">'
        f'<span class="masonry-caption__title" data-caption-it="{title}" '
        f'data-caption-en="{title}" data-caption-sl="{title}">{title}</span></span>'
    )


def replace_between_markers(page: str, start: str, end: str, generated: str) -> str:
    pattern = re.compile(
        rf"(?P<start>^[ \t]*{re.escape(start)}[ \t]*$).*?(?P<end>^[ \t]*{re.escape(end)}[ \t]*$)",
        re.MULTILINE | re.DOTALL,
    )
    match = pattern.search(page)
    if not match:
        raise RuntimeError(f"Marker mancanti: {start} / {end}")
    return page[: match.start()] + match.group("start") + "\n" + generated + "\n" + match.group("end") + page[match.end() :]


def update_gallery(category: str) -> int:
    config = CATEGORIES[category]
    page_path = ROOT / config["page"]
    page = read_document(page_path)
    alt_texts = existing_alt_texts(page, category)
    old_items = existing_gallery_items(page, category)
    masters = source_files(PS_DIR / category, re.compile(r"\d+"), SOURCE_PRIORITY)
    if not masters:
        raise RuntimeError(f"Nessuna immagine sorgente trovata in PS/{category}")

    output_dir = OPTIMIZED_DIR / category
    current_keys = {master.stem for master in masters}
    for existing in output_dir.glob("*.webp"):
        match = re.fullmatch(r"(.+)-\d+\.webp", existing.name, re.IGNORECASE)
        if match and match.group(1).isdigit() and match.group(1) not in current_keys:
            existing.unlink()

    preceding_items = page[: page.index("<!-- AUTO-GALLERY:START -->")].count('data-gallery-id="')
    total_items = preceding_items + len(masters)
    generated_items: list[str] = []
    for position, master in enumerate(masters, start=1):
        gallery_id = f"{category}-{master.stem}"
        old_item = old_items.get(gallery_id, "")
        if 'data-gallery-managed="true"' in old_item:
            generated_items.append("                " + old_item)
            continue
        responsive = generate_variants(
            master,
            output_dir,
            f"assets/optimized/PS/{category}",
        )
        alt = alt_texts.get(master.stem, f'{config["default_alt"]} {master.stem}')
        caption = existing_caption(old_item, alt)
        generated_items.append(gallery_item(
            responsive, category, position, alt, caption, total_items, preceding_items,
        ))

    page = replace_between_markers(
        page,
        "<!-- AUTO-GALLERY:START -->",
        "<!-- AUTO-GALLERY:END -->",
        "\n".join(generated_items),
    )
    write_document(page_path, page)
    return len(masters)


def marker_content(page: str, key: str) -> str:
    pattern = re.compile(
        rf"<!-- AUTO-IMAGE:{re.escape(key)}:START -->(.*?)<!-- AUTO-IMAGE:{re.escape(key)}:END -->",
        re.DOTALL,
    )
    match = pattern.search(page)
    if not match:
        raise RuntimeError(f"Marker homepage mancanti per {key}")
    return match.group(1)


def update_problem_solution_images() -> int:
    index_path = ROOT / "index.html"
    page = read_document(index_path)
    masters = source_files(PS_DIR, re.compile(r"[PS]\d+"), ROOT_SOURCE_PRIORITY)
    if not masters:
        raise RuntimeError("Nessuna immagine P/S trovata nella cartella PS")

    for master in masters:
        content = marker_content(page, master.stem)
        alt_match = re.search(r'\balt="([^"]*)"', content)
        if not alt_match:
            raise RuntimeError(f"Testo alternativo mancante per {master.stem}")
        alt = html.escape(html.unescape(alt_match.group(1)), quote=True)
        responsive = generate_variants(master, OPTIMIZED_DIR, "assets/optimized/PS")
        fallback, srcset = variant_attributes(responsive)
        generated = (
            f'                    <img src="{fallback}" width="{responsive.width}" height="{responsive.height}" '
            f'srcset="{srcset}" sizes="(max-width: 767px) 90vw, 44vw" alt="{alt}" '
            f'loading="lazy" decoding="async" />'
        )
        page = replace_between_markers(
            page,
            f"<!-- AUTO-IMAGE:{master.stem}:START -->",
            f"<!-- AUTO-IMAGE:{master.stem}:END -->",
            generated,
        )

    write_document(index_path, page)
    return len(masters)


def main() -> None:
    counts = {category: update_gallery(category) for category in CATEGORIES}
    counts["problemi-soluzioni"] = update_problem_solution_images()
    summary = ", ".join(f"{name}: {count}" for name, count in counts.items())
    print(f"Immagini elaborate - {summary}")


if __name__ == "__main__":
    main()

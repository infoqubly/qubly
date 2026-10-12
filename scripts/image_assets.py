"""Synchronize manual image uploads, responsive families and cache versions.

The state records content hashes, not timestamps: a WebP-only replacement wins
over an unchanged JPG sibling, and running the pipeline twice changes nothing.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import shutil
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

from PIL import Image, ImageOps


RASTER = {".jpg", ".jpeg", ".png", ".webp", ".avif"}
IMAGE_EXTENSIONS = RASTER | {".svg", ".gif", ".ico"}
PRIORITY = {suffix: rank for rank, suffix in enumerate((".jpg", ".jpeg", ".png", ".webp", ".avif"))}
FAMILY = re.compile(r"^(.*)-(\d+)\.webp$", re.IGNORECASE)
TAG = re.compile(r"<(?:img|source|link|a)\b[^>]*>", re.IGNORECASE)
ATTRIBUTE = re.compile(r'([\w:-]+)\s*=\s*([\"\'])(.*?)\2', re.DOTALL)
URL = re.compile(
    r"(?<![\w/:%.-])(?P<url>(?:(?:https?:)?//qubly\.studio/|/|(?:\.\.?/)*)"
    r"(?:[\w%.-]+/)*[\w%.-]+\.(?:jpe?g|png|webp|avif|svg|gif|ico))"
    r"(?P<query>\?[^\s\"'<>),#]*)?(?P<fragment>\#[^\s\"'<>),]*)?", re.IGNORECASE,
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10]


def read(path: Path) -> str:
    with path.open(encoding="utf-8", newline="") as handle:
        return handle.read()


def write_if_changed(path: Path, text: str) -> None:
    if read(path) != text:
        with path.open("w", encoding="utf-8", newline="") as handle:
            handle.write(text)


class ImageAssets:
    def __init__(self, root: Path, generator):
        self.root = root.resolve()
        self.generator = generator
        self.state_path = self.root / "scripts/image-state.json"
        self.state = json.loads(self.state_path.read_text(encoding="utf-8")) if self.state_path.exists() else {}
        self.selection: dict[str, Path] = {}
        self.images = {}

    def relative(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix()

    def originals(self) -> list[Path]:
        # Generated copies and pending catalog requests are never originals.
        result = []
        for directory, folders, files in os.walk(self.root):
            parent = Path(directory)
            folders[:] = [name for name in folders if name not in {
                ".git", ".wrangler", "node_modules", "vendor", ".github", "scripts", "__pycache__",
            } and self.relative(parent / name) not in {"assets/optimized", "gallery/inbox"}]
            result.extend(parent / name for name in files if Path(name).suffix.lower() in RASTER)
        return sorted(result)

    def families(self) -> dict[str, list[tuple[int, Path]]]:
        result = {}
        for path in (self.root / "assets/optimized").rglob("*.webp"):
            match = FAMILY.fullmatch(path.name)
            if match:
                key = self.relative(path.parent / match[1])
                result.setdefault(key, []).append((int(match[2]), path))
        return {key: sorted(variants) for key, variants in result.items()}

    def prepare_sources(self) -> dict[str, Path]:
        previous_sources = self.state.get("sources", {})
        previous_selection = self.state.get("selected", {})
        groups = {}
        for path in self.originals():
            groups.setdefault(self.relative(path.with_suffix("")), []).append(path)

        for family, variants in self.families().items():
            key = family.removeprefix("assets/optimized/")
            candidates = groups.get(key, [])
            changed_original = any(previous_sources.get(self.relative(path)) != digest(path)
                                   for path in candidates) if previous_sources else False
            previous_variants = {url: value for _, url, value in
                                 self.state.get("generated", {}).get(family, {}).get("variants", [])}
            changed_variants = [(width, path) for width, path in variants
                                if previous_variants and previous_variants.get(self.relative(path)) != digest(path)]
            if not candidates or (changed_variants and not changed_original):
                # Retain an original for catalog photos that used to exist only
                # as resized copies; also accept direct edits to those copies.
                source = self.root / f"{key}.webp"
                source.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile((changed_variants or variants)[-1][1], source)
                if source not in candidates:
                    candidates.append(source)
                groups[key] = candidates
                if not previous_variants and not changed_variants:
                    # Existing catalog photos already have approved WebPs.
                    # Keep those bytes on migration instead of recompressing
                    # a lossy copy; future uploads regenerate the family.
                    with Image.open(source) as opened:
                        width, height = ImageOps.exif_transpose(opened).size
                    self.state.setdefault("generated", {})[family] = {
                        "source": self.relative(source), "digest": digest(source),
                        "width": width, "height": height, "targets": [640, 1280, 1920],
                        "variants": [[size, self.relative(path), digest(path)] for size, path in variants],
                    }

        for key, candidates in groups.items():
            changed = [path for path in candidates if previous_sources
                       and previous_sources.get(self.relative(path)) != digest(path)]
            remembered = self.root / previous_selection[key] if key in previous_selection else None
            chosen = min(changed or ([remembered] if remembered in candidates else candidates),
                         key=lambda path: (PRIORITY[path.suffix.lower()], self.relative(path)))
            self.selection[key] = chosen
        return self.selection

    def update_assets(self) -> int:
        for family in self.families():
            key = family.removeprefix("assets/optimized/")
            source = self.selection.get(key)
            if source is None:
                raise ValueError(f"Originale non trovato per {family}")
            output_dir = self.root / Path(family).parent
            targets = (640, 1280) if key == "Sfondo" else (640, 1280, 1920)
            self.images[family] = self.generator(source, output_dir, self.relative(output_dir), targets)
        return len(self.images)

    def local_path(self, url: str, document: Path) -> Path | None:
        parsed = urlsplit(html.unescape(url))
        if parsed.scheme not in {"", "http", "https"} or (parsed.netloc and parsed.netloc != "qubly.studio"):
            return None
        path = (self.root / unquote(parsed.path).lstrip("/") if parsed.netloc or parsed.path.startswith("/")
                else document.parent / unquote(parsed.path)).resolve()
        return path if path.is_relative_to(self.root) else None

    def family_for(self, url: str, document: Path):
        path = self.local_path(url, document)
        if path:
            match = FAMILY.fullmatch(path.name)
            if match:
                return self.images.get(self.relative(path.parent / match[1]))
        return None

    def url_for(self, old: str, path: Path, document: Path, version: bool = True) -> str:
        import posixpath
        parsed = urlsplit(html.unescape(old))
        relative = self.relative(path)
        new_path = "/" + relative if parsed.netloc or parsed.path.startswith("/") else posixpath.relpath(
            relative, self.relative(document.parent) or ".")
        query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "v"]
        if version and path.is_file():
            query.append(("v", digest(path)))
        return urlunsplit((parsed.scheme, parsed.netloc, new_path, urlencode(query), parsed.fragment))

    def replace_tag(self, match: re.Match, document: Path) -> str:
        tag = match[0]
        attrs = {name.lower(): html.unescape(value) for name, _, value in ATTRIBUTE.findall(tag)}
        image = next((self.family_for(attrs[name].split(",")[0].split()[0], document)
                      for name in ("src", "href", "srcset", "imagesrcset") if attrs.get(name)
                      and self.family_for(attrs[name].split(",")[0].split()[0], document)), None)
        updates = {}
        if image:
            for name in ("src", "href"):
                if name in attrs and self.family_for(attrs[name], document):
                    existing = self.local_path(attrs[name], document)
                    variants = {self.root / url for _, url in image.variants}
                    target = existing if name == "src" and existing in variants else self.root / image.variants[-1][1]
                    updates[name] = self.url_for(attrs[name], target, document)
            for name in ("srcset", "imagesrcset"):
                if name in attrs:
                    sample = attrs[name].split(",")[0].split()[0]
                    updates[name] = ", ".join(f"{self.url_for(sample, self.root / url, document)} {width}w"
                                              for width, url in image.variants)
            for name, value in (("width", image.width), ("height", image.height),
                                ("data-pswp-width", image.width), ("data-pswp-height", image.height)):
                if name in attrs:
                    updates[name] = str(value)
        else:
            # Direct image uploads (logos, favicon, posters, full-size gallery
            # links) also need correct dimensions and changed-extension links.
            for name in ("src", "href"):
                if name not in attrs:
                    continue
                path = self.local_path(attrs[name], document)
                if path and path.suffix.lower() in RASTER:
                    source = self.selection.get(self.relative(path.with_suffix("")), path)
                    if source.is_file():
                        updates[name] = self.url_for(attrs[name], source, document)
                        with Image.open(source) as opened:
                            width, height = ImageOps.exif_transpose(opened).size
                            mime = Image.MIME.get(opened.format, attrs.get("type", ""))
                        for attr, value in (("width", width), ("height", height),
                                            ("data-pswp-width", width), ("data-pswp-height", height)):
                            if attr in attrs:
                                updates[attr] = str(value)
                        if attrs.get("rel") == "icon" and "type" in attrs:
                            updates["type"] = mime
                elif path and path.suffix.lower() in IMAGE_EXTENSIONS and path.is_file():
                    updates[name] = self.url_for(attrs[name], path, document)

        return ATTRIBUTE.sub(lambda attr: f'{attr[1]}={attr[2]}{html.escape(updates[attr[1].lower()], quote=True)}{attr[2]}'
                             if attr[1].lower() in updates else attr[0], tag)

    def version_images(self, text: str, document: Path) -> str:
        def replace(match):
            old = match[0]
            path = self.local_path(old, document)
            if path is None or path.suffix.lower() not in IMAGE_EXTENSIONS:
                return old
            image = self.family_for(old, document)
            if image and not path.is_file():
                path = self.root / image.variants[-1][1]
            elif not image:
                path = self.selection.get(self.relative(path.with_suffix("")), path)
            if not path.is_file():
                return old
            updated = self.url_for(old, path, document)
            return updated.replace("&", "&amp;") if document.suffix == ".html" else updated
        return URL.sub(replace, text)

    def update_references(self) -> None:
        # CSS/JS image URLs can be cached themselves; version their HTML imports
        # only after updating the dependencies.
        for folder in ("css", "js"):
            for document in sorted((self.root / folder).rglob("*")):
                if document.suffix in {".css", ".js"}:
                    write_if_changed(document, self.version_images(read(document), document))
        for document in sorted(self.root.glob("*.html")):
            text = TAG.sub(lambda match: self.replace_tag(match, document), read(document))
            text = self.version_images(text, document)
            def dependency(match):
                path = self.local_path(match[2], document)
                if path and path.suffix in {".css", ".js"} and path.is_file():
                    return match[1] + html.escape(self.url_for(match[2], path, document), quote=True) + match[3]
                return match[0]
            text = re.sub(r'((?:src|href)=\")([^\"]+\.(?:css|js)(?:\?[^\"]*)?)(\")', dependency, text)
            write_if_changed(document, text)

    def save(self) -> None:
        self.state["version"] = 1
        self.state["sources"] = {self.relative(path): digest(path) for path in self.originals()}
        self.state["selected"] = {key: self.relative(path) for key, path in self.selection.items()}
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(json.dumps(self.state, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")

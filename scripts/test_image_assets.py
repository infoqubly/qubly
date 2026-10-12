"""Regression checks for manual uploads and the published responsive images."""

from __future__ import annotations

import contextlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import image_assets
import optimize_images


class ManualImageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for directory in ("PS/Selezione", "assets/optimized", "scripts", "css", "js"):
            (self.root / directory).mkdir(parents=True, exist_ok=True)
        self.patches = contextlib.ExitStack()
        self.addCleanup(self.patches.close)
        for name, value in (("ROOT", self.root), ("PS_DIR", self.root / "PS"),
                            ("OPTIMIZED_DIR", self.root / "assets/optimized/PS"),
                            ("SOURCE_SELECTION", {}), ("GENERATION_STATE", {})):
            self.patches.enter_context(patch.object(optimize_images, name, value))

    def image(self, name, size=(800, 600), color="red", **options):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", size, color).save(path, **options)
        return path

    def document(self, name, text):
        (self.root / name).write_text(text, encoding="utf-8")

    def run_pipeline(self):
        pipeline = image_assets.ImageAssets(self.root, optimize_images.generate_variants)
        optimize_images.SOURCE_SELECTION = pipeline.prepare_sources()
        optimize_images.GENERATION_STATE = pipeline.state.setdefault("generated", {})
        pipeline.update_assets()
        pipeline.update_references()
        pipeline.save()
        return pipeline

    def carousel(self):
        self.image("PS/Selezione/01.jpg")
        self.image("assets/optimized/PS/Selezione/01-640.webp", (640, 480), "blue")
        self.image("assets/optimized/PS/Selezione/01-800.webp", (800, 600), "blue")
        self.document("index.html", '<link rel="preload" href="assets/optimized/PS/Selezione/01-800.webp" '
                      'imagesrcset="assets/optimized/PS/Selezione/01-640.webp 640w, assets/optimized/PS/Selezione/01-800.webp 800w">'
                      '<img data-full-src="PS/Selezione/01.jpg" src="assets/optimized/PS/Selezione/01-800.webp" '
                      'srcset="assets/optimized/PS/Selezione/01-640.webp 640w, assets/optimized/PS/Selezione/01-800.webp 800w" '
                      'width="800" height="600" sizes="90vw" loading="lazy" alt="Titolo originale">')

    def test_carousel_replacement_updates_every_size_and_preload(self):
        self.carousel()
        self.run_pipeline()
        self.image("PS/Selezione/01.jpg", (1000, 500), "green")
        self.run_pipeline()
        page = (self.root / "index.html").read_text()
        self.assertNotIn("01-800.webp", page)
        self.assertIn('width="1000" height="500"', page)
        self.assertIn('sizes="90vw" loading="lazy" alt="Titolo originale"', page)
        self.assertIn("01-1000.webp?v=", page)
        self.assertIn('data-full-src="PS/Selezione/01.jpg?v=', page)
        self.assertFalse((self.root / "assets/optimized/PS/Selezione/01-800.webp").exists())
        for width in (640, 1000):
            with Image.open(self.root / f"assets/optimized/PS/Selezione/01-{width}.webp") as image:
                self.assertEqual(image.size, (width, width // 2))
                self.assertGreater(image.getpixel((0, 0))[1], 100)

    def test_webp_only_upload_wins_over_unchanged_jpg_and_stays_selected(self):
        self.carousel()
        self.image("PS/Selezione/01.webp", color="blue")
        self.run_pipeline()
        self.image("PS/Selezione/01.webp", (900, 450), "green")
        pipeline = self.run_pipeline()
        self.assertEqual(pipeline.selection["PS/Selezione/01"].suffix, ".webp")
        page = (self.root / "index.html").read_text()
        self.assertIn('data-full-src="PS/Selezione/01.webp?v=', page)
        self.assertIn('width="900" height="450"', page)
        before = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        self.run_pipeline()
        after = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(before, after, "A second run must not recompress inputs or change versions")

    def test_direct_optimized_upload_regenerates_siblings_from_new_copy(self):
        self.carousel()
        self.run_pipeline()
        original = (self.root / "PS/Selezione/01.jpg").read_bytes()
        self.image("assets/optimized/PS/Selezione/01-640.webp", (640, 320), "green")
        pipeline = self.run_pipeline()
        self.assertEqual(pipeline.selection["PS/Selezione/01"].name, "01.webp")
        self.assertEqual(original, (self.root / "PS/Selezione/01.jpg").read_bytes())
        page = (self.root / "index.html").read_text()
        self.assertIn('width="640" height="320"', page)
        self.assertNotIn("01-800.webp", page)

    def test_original_has_precedence_if_original_and_generated_copy_change_together(self):
        self.carousel()
        self.run_pipeline()
        self.image("PS/Selezione/01.jpg", (1000, 500), "green")
        self.image("assets/optimized/PS/Selezione/01-640.webp", color="blue")
        pipeline = self.run_pipeline()
        self.assertEqual(pipeline.selection["PS/Selezione/01"].suffix, ".jpg")
        self.assertIn('width="1000"', (self.root / "index.html").read_text())

    def test_catalog_only_photo_gets_replaceable_original_and_keeps_metadata(self):
        existing = self.image("assets/optimized/PS/reviewed/03-800.webp").read_bytes()
        self.document("interni.html", '<a href="assets/optimized/PS/reviewed/03-800.webp" '
                      'data-gallery-id="reviewed-03" data-pswp-width="800" data-pswp-height="600">'
                      '<img src="assets/optimized/PS/reviewed/03-800.webp" width="800" height="600">'
                      '<span data-caption-it="Sala" data-caption-en="Room" data-caption-sl="Soba">Sala</span></a>')
        self.run_pipeline()
        self.assertTrue((self.root / "PS/reviewed/03.webp").exists())
        self.assertEqual(existing, (self.root / "assets/optimized/PS/reviewed/03-800.webp").read_bytes())
        self.image("PS/reviewed/03.webp", (700, 350), "green")
        self.run_pipeline()
        page = (self.root / "interni.html").read_text()
        self.assertIn('data-gallery-id="reviewed-03"', page)
        self.assertIn('data-caption-en="Room"', page)
        self.assertIn('data-pswp-width="700" data-pswp-height="350"', page)

    def test_root_images_css_background_and_css_import_are_versioned(self):
        self.image("logo-loader.webp", (32, 32))
        self.image("favicon.png", (16, 16))
        self.image("Sfondo.webp", (800, 600))
        self.image("assets/optimized/Sfondo-640.webp", (640, 480))
        self.document("css/styles.css", 'body{background:url("../assets/optimized/Sfondo-640.webp")}')
        self.document("index.html", '<link href="css/styles.css?v=103" rel="stylesheet">'
                      '<link rel="icon" href="favicon.png" type="image/png">'
                      '<img src="logo-loader.webp?v=1" width="640" height="640">')
        self.run_pipeline()
        before = (self.root / "index.html").read_text()
        self.image("Sfondo.webp", (800, 600), "blue")
        self.image("logo-loader.webp", (64, 64), "green")
        self.run_pipeline()
        after = (self.root / "index.html").read_text()
        self.assertNotEqual(before, after)
        self.assertIn('src="logo-loader.webp?v=', after)
        self.assertIn('width="64" height="64"', after)
        self.assertIn("favicon.png?v=", after)
        self.assertIn("Sfondo-640.webp?v=", (self.root / "css/styles.css").read_text())
        self.assertNotIn("styles.css?v=103", after)

    def test_extension_change_updates_original_zoom_link_dimensions_and_preserves_query(self):
        self.image("PS/interni/01.jpg")
        self.document("interni.html", '<a href="PS/interni/01.jpg?download=1&amp;v=old#full" '
                      'data-gallery-id="interni-01" data-pswp-width="800" data-pswp-height="600">Apri</a>')
        self.run_pipeline()
        self.image("PS/interni/01.png", (700, 500), "green")
        self.run_pipeline()
        page = (self.root / "interni.html").read_text()
        self.assertIn("01.png?download=1&amp;v=", page)
        self.assertIn('#full"', page)
        self.assertIn('data-pswp-width="700" data-pswp-height="500"', page)

    def test_new_asset_directory_and_external_urls(self):
        self.image("images/new-photo.png")
        (self.root / "mark.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
        self.document("index.html", '<img src="images/new-photo.png"><img src="mark.svg">'
                      '<img src="https://other.example/logo.png"><img src="data:image/png;base64,abc">')
        self.run_pipeline()
        page = (self.root / "index.html").read_text()
        self.assertIn("images/new-photo.png?v=", page)
        self.assertIn("mark.svg?v=", page)
        self.assertIn('src="https://other.example/logo.png"', page)
        self.assertIn('src="data:image/png;base64,abc"', page)

    def test_exif_orientation_and_transparency_survive_generation(self):
        source = self.root / "PS/portrait.jpg"
        exif = Image.Exif()
        exif[274] = 6
        Image.new("RGB", (100, 200), "red").save(source, exif=exif)
        output = self.root / "assets/optimized/PS"
        oriented = optimize_images.generate_variants(source, output, "assets/optimized/PS")
        self.assertEqual((oriented.width, oriented.height), (200, 100))
        transparent = self.root / "PS/transparent.png"
        Image.new("RGBA", (30, 20), (1, 2, 3, 0)).save(transparent)
        generated = optimize_images.generate_variants(transparent, output, "assets/optimized/PS")
        with Image.open(self.root / generated.variants[-1][1]) as image:
            self.assertEqual(image.getpixel((0, 0))[3], 0)


if __name__ == "__main__":
    unittest.main()

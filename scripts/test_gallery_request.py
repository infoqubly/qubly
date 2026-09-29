"""Local checks for the GitHub gallery issue workflow."""

from __future__ import annotations

import io
import json
import shutil
import struct
import tempfile
import unittest
import warnings
import zlib
from pathlib import Path

from PIL import Image

import gallery_request
import gallery_catalog
import gallery_publish
import optimize_images


SOURCE_ROOT = Path(__file__).resolve().parents[1]


def fixture_image(color: str = "#4a6677") -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (800, 600), color).save(output, "JPEG", quality=85)
    return output.getvalue()


def issue(number: int, title: str, fields: dict[str, str]) -> dict:
    body = "\n\n".join(f"### {key}\n\n{value}" for key, value in fields.items())
    return {"issue": {"number": number, "title": title, "body": body}}


class GalleryRequestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        for category in gallery_request.CATEGORIES:
            shutil.copy2(SOURCE_ROOT / f"{category}.html", self.root / f"{category}.html")
        (self.root / "gallery").mkdir()
        shutil.copy2(SOURCE_ROOT / "gallery/catalog.json", self.root / "gallery/catalog.json")
        gallery_catalog.ROOT = self.root
        gallery_catalog.CATALOG_PATH = self.root / "gallery/catalog.json"
        gallery_request.ROOT = self.root
        gallery_request.ASSET_DIR = self.root / "assets/optimized/PS/managed"
        optimize_images.ROOT = self.root
        optimize_images.PS_DIR = self.root / "PS"
        optimize_images.OPTIMIZED_DIR = self.root / "assets/optimized/PS"
        gallery_publish.ROOT = self.root
        gallery_publish.INBOX = self.root / "gallery/inbox"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_add_image_with_title_and_webp_variants(self) -> None:
        event = issue(9001, "Nuova foto: Costa al tramonto", {
            "Sezione": "Paesaggi", "Titolo italiano": "Costa al tramonto",
            "Titolo inglese": "Coast at sunset", "Titolo sloveno": "Obala ob sončnem zahodu",
        })
        category, gallery_id = gallery_request.apply_request(event, fixture_image())
        self.assertEqual((category, gallery_id), ("paesaggi", "nuova-9001"))
        page = (self.root / "paesaggi.html").read_text(encoding="utf-8")
        self.assertEqual(page.count('data-gallery-id="nuova-9001"'), 1)
        self.assertIn('data-caption-en="Coast at sunset"', page)
        self.assertLess(page.index('data-gallery-id="nuova-9001"'), page.index("<!-- GALLERY-ITEMS:END -->"))
        self.assertTrue((gallery_request.ASSET_DIR / "nuova-9001-640.webp").is_file())
        self.assertTrue((gallery_request.ASSET_DIR / "nuova-9001-800.webp").is_file())

    def test_replace_reviewed_image_keeps_its_place(self) -> None:
        before = (self.root / "esterni.html").read_text(encoding="utf-8")
        event = issue(9002, "Sostituzione di facciata", {
            "Foto selezionata": "reviewed-28", "Titolo italiano": "Nuova facciata",
        })
        gallery_request.apply_request(event, fixture_image("#875d45"))
        after = (self.root / "esterni.html").read_text(encoding="utf-8")
        self.assertEqual(before.count('data-gallery-id="'), after.count('data-gallery-id="'))
        self.assertEqual(after.count('data-gallery-id="reviewed-28"'), 1)
        self.assertIn('data-caption-it="Nuova facciata"', after)
        self.assertIn('data-caption-en="Façade detail"', after)
        self.assertIn('data-gallery-managed="true"', after)
        self.assertLess(after.index('data-gallery-id="reviewed-28"'), after.index('data-gallery-id="reviewed-03"'))

    def test_original_image_replacement_survives_optimizer(self) -> None:
        event = issue(9003, "[Sostituisci foto] complesso civico", {"ID foto": "esterni-01"})
        gallery_request.apply_request(event, fixture_image("#274a48"))
        source_dir = self.root / "PS/esterni"
        source_dir.mkdir(parents=True)
        (source_dir / "01.jpg").write_bytes(fixture_image("#4b4b4b"))
        optimize_images.update_gallery("esterni")
        page = (self.root / "esterni.html").read_text(encoding="utf-8")
        self.assertEqual(page.count('data-gallery-id="esterni-01"'), 1)
        self.assertIn('assets/optimized/PS/managed/esterni-01-800.webp', page)
        self.assertIn('data-caption-it="Complesso civico"', page)

    def test_unmodified_original_keeps_caption_after_optimizer(self) -> None:
        source_dir = self.root / "PS/interni"
        source_dir.mkdir(parents=True)
        (source_dir / "01.jpg").write_bytes(fixture_image())
        optimize_images.update_gallery("interni")
        page = (self.root / "interni.html").read_text(encoding="utf-8")
        self.assertIn('data-gallery-id="interni-01"', page)
        self.assertIn('data-caption-it="Soggiorno contemporaneo"', page)

    def test_reordered_reviewed_and_original_photos_survive_optimizer(self) -> None:
        catalog = gallery_catalog.read_catalog()
        exterior = catalog["sections"]["esterni"]
        moved = exterior.pop(-1)
        exterior.insert(0, moved)
        gallery_catalog.CATALOG_PATH.write_text(json.dumps(catalog), encoding="utf-8")
        gallery_catalog.sync_pages(catalog)
        source_dir = self.root / "PS/esterni"
        source_dir.mkdir(parents=True)
        (source_dir / "01.jpg").write_bytes(fixture_image())
        optimize_images.update_gallery("esterni")
        page = (self.root / "esterni.html").read_text(encoding="utf-8")
        self.assertEqual(list(gallery_catalog.item_blocks(page))[0], moved["id"])
        self.assertEqual(len(gallery_catalog.item_blocks(page)), len(exterior))

    def test_direct_upload_replaces_photo_and_updates_catalog(self) -> None:
        gallery_publish.INBOX.mkdir()
        request_id = "a" * 32
        request = {
            "mode": "replace", "category": "interni", "id": "interni-09",
            "extension": "jpg", "titles": {"it": "Cucina luminosa", "en": "Bright kitchen", "sl": "Svetla kuhinja"},
        }
        (gallery_publish.INBOX / f"{request_id}.json").write_text(json.dumps(request), encoding="utf-8")
        (gallery_publish.INBOX / f"{request_id}.jpg").write_bytes(fixture_image())
        gallery_publish.main()
        page = (self.root / "interni.html").read_text(encoding="utf-8")
        self.assertIn('data-caption-it="Cucina luminosa"', gallery_catalog.item_blocks(page)["interni-09"])
        self.assertTrue((gallery_request.ASSET_DIR / "interni-09-640.webp").exists())
        updated = next(item for item in gallery_catalog.read_catalog()["sections"]["interni"] if item["id"] == "interni-09")
        self.assertEqual(updated["titles"]["it"], "Cucina luminosa")

    def test_rejects_invalid_target_and_untrusted_link(self) -> None:
        event = issue(9004, "[Sostituisci foto] test", {"ID foto": "../../secrets"})
        with self.assertRaises(ValueError):
            gallery_request.apply_request(event, fixture_image())
        with self.assertRaises(ValueError):
            gallery_request.attachment_url("![photo](https://example.com/private.png)")

    def test_rejects_compressed_oversized_image_before_decoding(self) -> None:
        output = io.BytesIO()
        Image.new("RGB", (640, 400)).save(output, "PNG")
        payload = bytearray(output.getvalue())
        payload[16:24] = struct.pack(">II", 10_000, 10_000)
        payload[29:33] = struct.pack(">I", zlib.crc32(payload[12:29]))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", Image.DecompressionBombWarning)
            with self.assertRaisesRegex(ValueError, "50 megapixel"):
                gallery_request.image_variants("oversized-image", bytes(payload))

    def test_reads_github_upload_link(self) -> None:
        url = "https://github.com/user-attachments/assets/9e13f9bc"
        self.assertEqual(gallery_request.attachment_url(f"![foto.jpg]({url})"), url)

    def test_new_photo_requires_three_written_titles(self) -> None:
        event = issue(9005, "Nuova foto", {
            "Sezione": "Esterni", "Titolo italiano": "Casa tra i pini",
        })
        with self.assertRaisesRegex(ValueError, "italiano, inglese e sloveno"):
            gallery_request.apply_request(event, fixture_image())

    def test_optimizer_preserves_crlf_documents(self) -> None:
        page = "prima\r\n<!-- AUTO-GALLERY:START -->\r\nvecchio\r\n<!-- AUTO-GALLERY:END -->\r\ndopo\r\n"
        updated = optimize_images.replace_between_markers(
            page, "<!-- AUTO-GALLERY:START -->", "<!-- AUTO-GALLERY:END -->", "nuovo"
        )
        self.assertIn("nuovo\r\n<!-- AUTO-GALLERY:END -->", updated)
        self.assertEqual(updated.count("\n"), updated.count("\r\n"))


if __name__ == "__main__":
    unittest.main()

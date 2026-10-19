"""Local checks for the GitHub gallery issue workflow."""

from __future__ import annotations

import io
import json
import shutil
import struct
import subprocess
import tempfile
import unittest
import warnings
import zlib
from pathlib import Path
from unittest import mock

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

    def git(self, *arguments: str) -> None:
        subprocess.run(
            ["git", "-c", "user.name=Gallery test", "-c", "user.email=gallery@example.test", *arguments],
            cwd=self.root, capture_output=True, check=True,
        )

    def queued_request(self, request_id: str, mode: str, title: str, gallery_id: str = "interni-09") -> Path:
        gallery_publish.INBOX.mkdir(exist_ok=True)
        request = {
            "mode": mode, "category": "interni", "extension": "jpg",
            "titles": {"it": title, "en": title, "sl": title},
        }
        if mode == "replace":
            request["id"] = gallery_id
        path = gallery_publish.INBOX / f"{request_id}.json"
        path.write_text(json.dumps(request), encoding="utf-8")
        path.with_suffix(".jpg").write_bytes(fixture_image())
        return path

    def commit_fixture(self) -> None:
        self.git("add", "--all")
        self.git("commit", "-m", "Add upload request")

    def test_source_galleries_have_unique_ids_matching_catalog(self) -> None:
        catalog = gallery_catalog.read_catalog()
        removed = set(catalog.get("removed", []))
        for category in gallery_catalog.CATEGORIES:
            with self.subTest(category=category):
                page = (self.root / f"{category}.html").read_text(encoding="utf-8")
                blocks = gallery_catalog.item_blocks(page)
                expected_ids = [
                    item["id"] for item in catalog["sections"][category]
                    if item["id"] not in removed
                ]
                self.assertEqual(len(expected_ids), len(set(expected_ids)))
                self.assertEqual(set(blocks), set(expected_ids))

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

    def test_queued_replacements_and_addition_keep_unique_ids_and_catalog_order(self) -> None:
        gallery_id = "interni-09"
        catalog = gallery_catalog.read_catalog()
        section = catalog["sections"]["interni"]
        selected = next(item for item in section if item["id"] == gallery_id)
        section.remove(selected)
        section.insert(0, selected)
        chosen_order = [item["id"] for item in section]
        gallery_catalog.CATALOG_PATH.write_text(json.dumps(catalog), encoding="utf-8")

        final_titles = {"it": "Cucina aggiornata", "en": "Updated kitchen", "sl": "Posodobljena kuhinja"}
        added_titles = {"it": "Nuovo soggiorno", "en": "New living room", "sl": "Nova dnevna soba"}
        gallery_publish.INBOX.mkdir()
        requests = [
            ("a" * 32, "replace", {"it": "Prima cucina", "en": "First kitchen", "sl": "Prva kuhinja"}, "#875d45"),
            ("b" * 32, "replace", final_titles, "#274a48"),
            ("c" * 32, "add", added_titles, "#4a6677"),
        ]
        for request_id, mode, titles, color in requests:
            request = {
                "mode": mode, "category": "interni", "extension": "jpg", "titles": titles,
            }
            if mode == "replace":
                request["id"] = gallery_id
            (gallery_publish.INBOX / f"{request_id}.json").write_text(json.dumps(request), encoding="utf-8")
            (gallery_publish.INBOX / f"{request_id}.jpg").write_bytes(fixture_image(color))

        gallery_publish.main()

        page = (self.root / "interni.html").read_text(encoding="utf-8")
        blocks = gallery_catalog.item_blocks(page)
        added_id = "photo-" + "c" * 32
        self.assertEqual(list(blocks), chosen_order + [added_id])
        for target_id, titles in ((gallery_id, final_titles), (added_id, added_titles)):
            with self.subTest(gallery_id=target_id):
                self.assertEqual(page.count(f'data-gallery-id="{target_id}"'), 1)
                self.assertEqual(gallery_catalog.item_data(target_id, blocks[target_id])["titles"], titles)
        published_section = gallery_catalog.read_catalog()["sections"]["interni"]
        self.assertEqual([item["id"] for item in published_section], chosen_order + [added_id])
        self.assertEqual(published_section[0]["titles"], final_titles)
        self.assertEqual(published_section[-1]["titles"], added_titles)
        self.assertEqual(list(gallery_publish.INBOX.iterdir()), [])

    def test_queued_replacements_follow_commit_order_instead_of_uuid(self) -> None:
        self.git("init", "--initial-branch=main")
        self.queued_request("f" * 32, "replace", "Prima cucina")
        self.commit_fixture()
        self.queued_request("a" * 32, "replace", "Ultima cucina")
        self.commit_fixture()

        gallery_publish.main()

        page = (self.root / "interni.html").read_text(encoding="utf-8")
        published = gallery_catalog.item_data("interni-09", gallery_catalog.item_blocks(page)["interni-09"])
        self.assertEqual(published["titles"]["it"], "Ultima cucina")
        self.assertEqual(list(gallery_publish.INBOX.iterdir()), [])

    def test_queued_additions_follow_commit_order_instead_of_uuid(self) -> None:
        self.git("init", "--initial-branch=main")
        original_order = [item["id"] for item in gallery_catalog.read_catalog()["sections"]["interni"]]
        self.queued_request("f" * 32, "add", "Prima foto")
        self.commit_fixture()
        self.queued_request("a" * 32, "add", "Seconda foto")
        self.commit_fixture()

        gallery_publish.main()

        section = gallery_catalog.read_catalog()["sections"]["interni"]
        self.assertEqual([item["id"] for item in section], original_order + ["photo-" + "f" * 32, "photo-" + "a" * 32])

    def test_missing_git_history_has_stable_fallback_and_reports_limit(self) -> None:
        self.git("init", "--initial-branch=main")
        known = self.queued_request("f" * 32, "add", "Foto tracciata")
        self.commit_fixture()
        missing_last = self.queued_request("c" * 32, "add", "Foto non tracciata C")
        missing_first = self.queued_request("a" * 32, "add", "Foto non tracciata A")

        with mock.patch("sys.stderr", new_callable=io.StringIO) as output:
            requests = gallery_publish.ordered_requests()

        self.assertEqual(requests, [known, missing_first, missing_last])
        self.assertIn("L'ordine di caricamento non è verificabile", output.getvalue())

    def test_removed_photo_consumes_queued_replacements_without_restoring_it(self) -> None:
        catalog = gallery_catalog.read_catalog()
        gallery_id = "interni-09"
        catalog["sections"]["interni"] = [
            item for item in catalog["sections"]["interni"] if item["id"] != gallery_id
        ]
        catalog["removed"] = [gallery_id]
        gallery_catalog.CATALOG_PATH.write_text(json.dumps(catalog), encoding="utf-8")

        with mock.patch.object(gallery_request, "image_variants", wraps=gallery_request.image_variants) as variants:
            self.queued_request("a" * 32, "replace", "Foto rimossa", gallery_id)
            gallery_publish.main()
            variants.assert_not_called()
            # A subsequent replacement also succeeds after HTML no longer has the ID.
            self.queued_request("b" * 32, "replace", "Altra sostituzione rimossa", gallery_id)
            self.queued_request("c" * 32, "add", "Foto successiva")
            gallery_publish.main()
            self.assertEqual(variants.call_count, 1)
            self.assertEqual(variants.call_args.args[0], "photo-" + "c" * 32)

        page = (self.root / "interni.html").read_text(encoding="utf-8")
        self.assertNotIn(gallery_id, gallery_catalog.item_blocks(page))
        self.assertNotIn(gallery_id, [item["id"] for item in gallery_catalog.read_catalog()["sections"]["interni"]])
        self.assertEqual(list(gallery_publish.INBOX.iterdir()), [])
        self.assertEqual(list(gallery_request.ASSET_DIR.glob(f"{gallery_id}-*.webp")), [])

    def test_removed_photo_request_is_validated_before_being_consumed(self) -> None:
        catalog = gallery_catalog.read_catalog()
        catalog["removed"] = ["interni-09"]
        gallery_catalog.CATALOG_PATH.write_text(json.dumps(catalog), encoding="utf-8")
        request_path = self.queued_request("a" * 32, "replace", "")

        with self.assertRaisesRegex(ValueError, "tre titoli"):
            gallery_publish.main()

        self.assertTrue(request_path.exists())
        self.assertTrue(request_path.with_suffix(".jpg").exists())

    def test_removed_photo_stays_hidden_after_gallery_regeneration(self) -> None:
        catalog = gallery_catalog.read_catalog()
        gallery_id = "esterni-01"
        catalog["sections"]["esterni"] = [
            item for item in catalog["sections"]["esterni"] if item["id"] != gallery_id
        ]
        catalog["removed"] = [gallery_id]
        gallery_catalog.CATALOG_PATH.write_text(json.dumps(catalog), encoding="utf-8")
        gallery_publish.main()
        page = (self.root / "esterni.html").read_text(encoding="utf-8")
        self.assertNotIn(f'data-gallery-id="{gallery_id}"', page)

        source_dir = self.root / "PS/esterni"
        source_dir.mkdir(parents=True)
        (source_dir / "01.jpg").write_bytes(fixture_image())
        optimize_images.update_gallery("esterni")
        refreshed = gallery_catalog.refresh_catalog()
        self.assertNotIn(gallery_id, gallery_catalog.item_blocks((self.root / "esterni.html").read_text(encoding="utf-8")))
        self.assertNotIn(gallery_id, [item["id"] for item in refreshed["sections"]["esterni"]])
        self.assertTrue((source_dir / "01.jpg").exists())

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

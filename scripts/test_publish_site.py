"""Exercise publication retries against real, local Git repositories."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

import publish_site


class PublicationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.remote = self.directory / "origin.git"
        self.root = self.directory / "runner"
        self.writer = self.directory / "writer"
        self.command(self.directory, "init", "--bare", "--initial-branch=main", str(self.remote))
        self.command(self.directory, "clone", str(self.remote), str(self.root))
        self.configure(self.root)
        self.write(self.root, "index.html", "initial\n")
        self.write(self.root, "notes.txt", "tracked local notes\n")
        self.write_json(self.root, "gallery/catalog.json", {
            "order": ["one", "two", "three"], "removed": [],
        })
        self.write_json(self.root, "gallery/inbox/first.json", {"id": "first"})
        self.command(self.root, "add", "--all")
        self.command(self.root, "commit", "-m", "Initial gallery")
        self.command(self.root, "push", "origin", "HEAD:main")
        self.command(self.directory, "clone", str(self.remote), str(self.writer))
        self.configure(self.writer)

    @staticmethod
    def command(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", "-C", str(root), *args], check=True,
            text=True, encoding="utf-8", capture_output=True,
        )

    def configure(self, root: Path) -> None:
        self.command(root, "config", "user.name", "Publication Test")
        self.command(root, "config", "user.email", "publication-test@example.invalid")
        self.command(root, "config", "core.autocrlf", "false")
        self.command(root, "config", "commit.gpgsign", "false")

    @staticmethod
    def write(root: Path, name: str, value: str) -> None:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")

    def write_json(self, root: Path, name: str, value: object) -> None:
        self.write(root, name, json.dumps(value, sort_keys=True) + "\n")

    def remote_head(self) -> str:
        return self.command(self.remote, "rev-parse", "main").stdout.strip()

    def remote_text(self, path: str) -> str:
        return self.command(self.remote, "show", f"main:{path}").stdout

    def update_remote(self, files: dict[str, str], message: str = "Concurrent change") -> None:
        self.command(self.writer, "fetch", "origin", "main")
        self.command(self.writer, "reset", "--hard", "origin/main")
        for name, value in files.items():
            self.write(self.writer, name, value)
        self.command(self.writer, "add", "--all")
        self.command(self.writer, "commit", "-m", message)
        self.command(self.writer, "push", "origin", "HEAD:main")

    def assert_no_temporary_worktrees(self) -> None:
        worktrees = self.command(self.root, "worktree", "list", "--porcelain").stdout
        self.assertEqual(sum(line.startswith("worktree ") for line in worktrees.splitlines()), 1)

    def test_two_conflicts_keep_all_requests_latest_order_and_removal(self) -> None:
        attempts = []

        def generate(worktree: Path) -> None:
            self.assertNotEqual(worktree.resolve(), self.root.resolve())
            attempts.append(worktree)
            # A discarded generation must not contaminate the next attempt.
            stale = worktree / "assets/optimized/first-attempt.webp"
            self.assertFalse(stale.exists())
            catalog = json.loads((worktree / "gallery/catalog.json").read_text(encoding="utf-8"))
            published_path = worktree / "gallery/published.json"
            published = json.loads(published_path.read_text(encoding="utf-8")) if published_path.exists() else []
            for request in sorted((worktree / "gallery/inbox").glob("*.json")):
                published.append(json.loads(request.read_text(encoding="utf-8"))["id"])
                request.unlink()
            order = [photo for photo in catalog["order"] if photo not in catalog["removed"]]
            self.write_json(worktree, "gallery/published.json", published)
            self.write_json(worktree, "index.html", {"order": order, "requests": published})
            if len(attempts) == 1:
                self.write(worktree, "assets/optimized/first-attempt.webp", "discarded output")
                self.update_remote({
                    "gallery/catalog.json": json.dumps({"order": ["three", "two", "one"], "removed": []}),
                    "gallery/inbox/second.json": json.dumps({"id": "second"}),
                }, "Reorder and accept second upload")
            elif len(attempts) == 2:
                self.update_remote({
                    "gallery/catalog.json": json.dumps({"order": ["three", "one"], "removed": ["two"]}),
                    "gallery/inbox/third.json": json.dumps({"id": "third"}),
                }, "Remove photo and accept third upload")

        used = publish_site.publish(self.root, generate, "Publish gallery", retry_delay=0)

        self.assertEqual(used, 3)
        self.assertEqual(len(attempts), 3)
        result = json.loads(self.remote_text("index.html"))
        self.assertEqual(result, {"order": ["three", "one"], "requests": ["first", "second", "third"]})
        catalog = json.loads(self.remote_text("gallery/catalog.json"))
        self.assertEqual(catalog["removed"], ["two"])
        files = self.command(self.remote, "ls-tree", "-r", "--name-only", "main").stdout.splitlines()
        self.assertFalse(any(name.startswith("gallery/inbox/") for name in files))
        self.assertNotIn("assets/optimized/first-attempt.webp", files)
        self.assert_no_temporary_worktrees()

    def test_source_checkout_including_dirty_and_untracked_files_is_untouched(self) -> None:
        self.write(self.root, "notes.txt", "unsaved local edit\n")
        self.write(self.root, "private-local.txt", "untracked local data\n")
        self.write(self.root, "index.html", "local page being edited\n")
        original_head = self.command(self.root, "rev-parse", "HEAD").stdout
        original_status = self.command(self.root, "status", "--porcelain").stdout

        publish_site.publish(
            self.root, lambda worktree: self.write(worktree, "index.html", "published\n"),
            "Publish without touching checkout", retry_delay=0,
        )

        self.assertEqual(self.command(self.root, "rev-parse", "HEAD").stdout, original_head)
        self.assertEqual(self.command(self.root, "status", "--porcelain").stdout, original_status)
        self.assertEqual((self.root / "notes.txt").read_text(encoding="utf-8"), "unsaved local edit\n")
        self.assertEqual((self.root / "private-local.txt").read_text(encoding="utf-8"), "untracked local data\n")
        self.assertEqual((self.root / "index.html").read_text(encoding="utf-8"), "local page being edited\n")
        self.assertEqual(self.remote_text("index.html"), "published\n")
        self.assert_no_temporary_worktrees()

    def test_retry_limit_stops_without_publishing_an_outdated_generation(self) -> None:
        calls = []

        def generate(worktree: Path) -> None:
            calls.append(worktree)
            self.write(worktree, "index.html", f"generated attempt {len(calls)}\n")
            self.update_remote({"gallery/concurrent.txt": f"change {len(calls)}\n"})

        with self.assertRaises(publish_site.PublicationError):
            publish_site.publish(self.root, generate, "Never catches up", max_attempts=3, retry_delay=0)

        self.assertEqual(len(calls), 3)
        self.assertEqual(self.remote_text("index.html"), "initial\n")
        self.assertEqual(self.remote_text("gallery/concurrent.txt"), "change 3\n")
        self.assert_no_temporary_worktrees()

    def test_generation_failure_is_not_retried_or_published(self) -> None:
        initial_head = self.remote_head()
        calls = []

        def generate(worktree: Path) -> None:
            calls.append(worktree)
            self.write(worktree, "index.html", "incomplete output\n")
            raise ValueError("Invalid source image")

        with self.assertRaisesRegex((ValueError, publish_site.PublicationError), "Invalid source image"):
            publish_site.publish(self.root, generate, "Invalid publication", retry_delay=0)

        self.assertEqual(len(calls), 1)
        self.assertEqual(self.remote_head(), initial_head)
        self.assertEqual(self.remote_text("index.html"), "initial\n")
        self.assert_no_temporary_worktrees()

    def test_no_op_and_repeat_generation_do_not_create_extra_commits(self) -> None:
        initial_head = self.remote_head()
        self.assertEqual(publish_site.publish(self.root, lambda worktree: None, "No changes", retry_delay=0), 1)
        self.assertEqual(self.remote_head(), initial_head)
        generate = lambda worktree: self.write(worktree, "index.html", "deterministic output\n")
        self.assertEqual(publish_site.publish(self.root, generate, "First publication", retry_delay=0), 1)
        published_head = self.remote_head()
        self.assertNotEqual(published_head, initial_head)
        self.assertEqual(publish_site.publish(self.root, generate, "Already current", retry_delay=0), 1)
        self.assertEqual(self.remote_head(), published_head)
        self.assert_no_temporary_worktrees()

    def test_no_op_rechecks_remote_and_processes_input_received_during_generation(self) -> None:
        calls = []

        def generate(worktree: Path) -> None:
            calls.append(worktree)
            if len(calls) == 1:
                self.update_remote({"gallery/inbox/later.json": json.dumps({"id": "later"})})
                return
            request = worktree / "gallery/inbox/later.json"
            self.assertTrue(request.is_file())
            self.write(worktree, "index.html", "processed later upload\n")
            request.unlink()

        used = publish_site.publish(self.root, generate, "Drain fresh input", retry_delay=0)

        self.assertEqual(used, 2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(self.remote_text("index.html"), "processed later upload\n")
        files = self.command(self.remote, "ls-tree", "-r", "--name-only", "main").stdout.splitlines()
        self.assertNotIn("gallery/inbox/later.json", files)
        self.assert_no_temporary_worktrees()

    def test_issue_marker_skips_replay_after_a_newer_replacement(self) -> None:
        marker = "Gallery-Request: issue/42"
        generate = lambda worktree: self.write(worktree, "index.html", "original issue image\n")
        publish_site.publish(self.root, generate, "Apply issue 42", marker=marker, retry_delay=0)
        message = self.command(self.remote, "log", "-1", "--format=%B", "main").stdout
        self.assertIn(marker, message.splitlines())
        self.update_remote({"index.html": "newer replacement\n"}, "A later replacement")
        newest_head = self.remote_head()

        def must_not_generate(worktree: Path) -> None:
            self.fail("An already committed issue must not be replayed")

        self.assertEqual(publish_site.publish(
            self.root, must_not_generate, "Replay issue 42", marker=marker, retry_delay=0,
        ), 1)
        self.assertEqual(self.remote_head(), newest_head)
        self.assertEqual(self.remote_text("index.html"), "newer replacement\n")
        self.assert_no_temporary_worktrees()

    def test_issue_marker_requires_an_exact_line(self) -> None:
        self.update_remote({"gallery/other.txt": "another issue\n"}, "Other issue\n\nGallery-Request: issue/420")
        calls = []

        def generate(worktree: Path) -> None:
            calls.append(worktree)
            self.write(worktree, "index.html", "issue 42\n")

        publish_site.publish(
            self.root, generate, "Apply issue 42", marker="Gallery-Request: issue/42", retry_delay=0,
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.remote_text("index.html"), "issue 42\n")

    def test_no_op_issue_is_recorded_and_cannot_replay_after_a_later_change(self) -> None:
        marker = "Gallery-Request: issue/43"
        initial_head = self.remote_head()
        publish_site.publish(self.root, lambda worktree: None, "Identical replacement", marker=marker, retry_delay=0)
        self.assertNotEqual(self.remote_head(), initial_head)
        self.assertIn(marker, self.command(self.remote, "log", "-1", "--format=%B", "main").stdout.splitlines())
        self.update_remote({"index.html": "a newer image\n"})

        def must_not_generate(worktree: Path) -> None:
            self.fail("Even a no-op issue must never replay over a newer replacement")

        publish_site.publish(self.root, must_not_generate, "Replay", marker=marker, retry_delay=0)
        self.assertEqual(self.remote_text("index.html"), "a newer image\n")

    def test_rejected_push_with_unchanged_remote_is_not_retried(self) -> None:
        actual_git = publish_site.git
        initial_head = self.remote_head()
        generated = []
        pushes = []

        def denied_push(root: Path, *args: str, check: bool = True):
            if args and args[0] == "push":
                pushes.append(args)
                result = subprocess.CompletedProcess(["git", *args], 1, "", "permission denied")
                if check:
                    raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)
                return result
            return actual_git(root, *args, check=check)

        def generate(worktree: Path) -> None:
            generated.append(worktree)
            self.write(worktree, "index.html", "cannot publish\n")

        with patch.object(publish_site, "git", side_effect=denied_push):
            with self.assertRaises(publish_site.PublicationError):
                publish_site.publish(self.root, generate, "Unauthorized push", retry_delay=0)

        self.assertEqual(len(generated), 1)
        self.assertEqual(len(pushes), 1)
        self.assertEqual(self.remote_head(), initial_head)
        self.assert_no_temporary_worktrees()

    def test_push_applied_but_response_lost_counts_as_success(self) -> None:
        actual_git = publish_site.git
        calls = []
        pushes = []

        def ambiguous_push(root: Path, *args: str, check: bool = True):
            if args and args[0] == "push":
                pushes.append(args)
                actual_git(root, *args, check=True)
                result = subprocess.CompletedProcess(["git", *args], 1, "", "connection lost after push")
                if check:
                    raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)
                return result
            return actual_git(root, *args, check=check)

        def generate(worktree: Path) -> None:
            calls.append(worktree)
            self.write(worktree, "index.html", "accepted despite response loss\n")

        with patch.object(publish_site, "git", side_effect=ambiguous_push):
            self.assertEqual(publish_site.publish(self.root, generate, "Ambiguous push", retry_delay=0), 1)

        self.assertEqual(len(calls), 1)
        self.assertEqual(len(pushes), 1)
        self.assertEqual(self.remote_text("index.html"), "accepted despite response loss\n")
        self.assert_no_temporary_worktrees()


class GenerationIntegrationTests(unittest.TestCase):
    def test_issue_add_with_empty_inbox_survives_the_full_pipeline(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            site = directory / "site"
            scripts = site / "scripts"
            scripts.mkdir(parents=True)
            source_scripts = Path(__file__).resolve().parent
            for name in ("gallery_catalog.py", "gallery_publish.py", "gallery_request.py", "optimize_images.py", "image_assets.py"):
                shutil.copy2(source_scripts / name, scripts / name)
            categories = ("esterni", "interni", "paesaggi")
            for category in categories:
                (site / f"{category}.html").write_text(
                    '<div class="masonry-gallery layout-1">\n'
                    '    <!-- GALLERY-ITEMS:START -->\n'
                    '    <!-- GALLERY-ITEMS:END -->\n'
                    '</div>\n', encoding="utf-8",
                )
                originals = site / "PS" / category
                originals.mkdir(parents=True)
                Image.new("RGB", (800, 600), "#4a6677").save(originals / "01.jpg")
            (site / "index.html").write_text(
                '<!-- AUTO-IMAGE:P1:START -->\n'
                '<img src="PS/P1.jpg" alt="Foto iniziale" />\n'
                '<!-- AUTO-IMAGE:P1:END -->\n', encoding="utf-8",
            )
            Image.new("RGB", (800, 600), "#274a48").save(site / "PS/P1.jpg")
            (site / "gallery/inbox").mkdir(parents=True)
            catalog_path = site / "gallery/catalog.json"
            catalog_path.write_text(json.dumps({
                "version": 1, "sections": {category: [] for category in categories}, "removed": [],
            }), encoding="utf-8")
            event = directory / "event.json"
            event.write_text(json.dumps({"issue": {"number": 9021, "body": (
                "### Sezione\n\nPaesaggi\n\n"
                "### Titolo italiano\n\nNuova costa\n\n"
                "### Titolo inglese\n\nNew coast\n\n"
                "### Titolo sloveno\n\nNova obala\n\n"
                "### Nuova immagine\n\n![foto](https://github.com/user-attachments/assets/gallery-test)"
            )}}), encoding="utf-8")

            # Replace only network I/O in child interpreters. The real issue CLI,
            # validation, rendering, catalog sync and image optimizer all execute.
            network_fixture = directory / "network-fixture"
            network_fixture.mkdir()
            (network_fixture / "sitecustomize.py").write_text(
                "import io, os, pathlib, urllib.request\n"
                "def fixture_image(request, timeout=None):\n"
                "    assert request.full_url == 'https://github.com/user-attachments/assets/gallery-test'\n"
                "    return io.BytesIO(pathlib.Path(os.environ['GALLERY_TEST_IMAGE']).read_bytes())\n"
                "urllib.request.urlopen = fixture_image\n", encoding="utf-8",
            )
            with patch.dict(os.environ, {
                "PYTHONPATH": str(network_fixture), "GALLERY_TEST_IMAGE": str(site / "PS/P1.jpg"),
            }):
                publish_site.generate_site(site, event)

            page = (site / "paesaggi.html").read_text(encoding="utf-8")
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            added = [item for item in catalog["sections"]["paesaggi"] if item["id"] == "nuova-9021"]
            self.assertEqual(len(added), 1)
            self.assertEqual(added[0]["titles"], {"it": "Nuova costa", "en": "New coast", "sl": "Nova obala"})
            self.assertEqual(page.count('data-gallery-id="nuova-9021"'), 1)
            self.assertTrue((site / "assets/optimized/PS/managed/nuova-9021-800.webp").exists())
            self.assertTrue((site / "assets/optimized/PS/paesaggi/01-800.webp").exists())
            self.assertTrue((site / "scripts/image-state.json").exists())
            self.assertEqual(list((site / "gallery/inbox").iterdir()), [])


if __name__ == "__main__":
    unittest.main()

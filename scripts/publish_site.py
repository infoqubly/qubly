#!/usr/bin/env python3
"""Regenerate from current main when a concurrent edit rejects publication."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REMOTE_REF = "refs/remotes/origin/main"
BOT_NAME = "github-actions[bot]"
BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"


class PublicationError(RuntimeError):
    pass


def git(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args], cwd=root, text=True, encoding="utf-8", errors="replace",
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if check and result.returncode:
        raise PublicationError(result.stderr.strip() or result.stdout.strip() or "Comando Git non riuscito")
    return result


def latest_main(root: Path) -> str:
    git(root, "fetch", "--no-tags", "origin", f"+refs/heads/main:{REMOTE_REF}")
    return git(root, "rev-parse", REMOTE_REF).stdout.strip()


def already_published(root: Path, revision: str, marker: str) -> bool:
    messages = git(root, "log", revision, "--format=%B", "--fixed-strings", f"--grep={marker}").stdout
    return marker in messages.splitlines()


def publish(
    root: Path, generate: Callable[[Path], None], message: str, *,
    marker: str | None = None, max_attempts: int = 10, retry_delay: float = 2,
) -> int:
    """Publish only fast-forwards; each retry uses an entirely fresh worktree.

    The source checkout (including any local edits) is never reset or cleaned.
    Only the disposable worktree created here is removed after each attempt.
    """
    root = root.resolve()
    if max_attempts < 1:
        raise ValueError("Serve almeno un tentativo")
    for attempt in range(1, max_attempts + 1):
        base = latest_main(root)
        if marker and already_published(root, base, marker):
            print("Richiesta già pubblicata: nessuna modifica da ripetere.", flush=True)
            return attempt
        print(f"Pubblicazione: tentativo {attempt}/{max_attempts}, main {base[:12]}", flush=True)
        with tempfile.TemporaryDirectory(prefix="qubly-publish-") as temporary:
            # The removal target is this explicit child of our own temporary directory.
            worktree = Path(temporary).resolve() / "site"
            git(root, "worktree", "add", "--quiet", "--detach", str(worktree), base)
            try:
                generate(worktree)
                git(worktree, "add", "-A")
                changed = git(worktree, "diff", "--cached", "--quiet", check=False)
                if changed.returncode not in {0, 1}:
                    raise PublicationError(changed.stderr.strip() or "Impossibile verificare le modifiche")
                if changed.returncode == 0 and not marker:
                    # New input may have arrived even when this snapshot needed no changes.
                    if latest_main(root) == base:
                        print("Sito già aggiornato.", flush=True)
                        return attempt
                else:
                    args = ["-c", f"user.name={BOT_NAME}", "-c", f"user.email={BOT_EMAIL}", "commit", "-m", message]
                    if marker:
                        # Record even a no-op issue so a later replay cannot overwrite a newer photo.
                        args.append("--allow-empty")
                        args.extend(["-m", marker])
                    git(worktree, *args)
                    commit = git(worktree, "rev-parse", "HEAD").stdout.strip()
                    # Push from the authenticated source checkout; worktrees share its objects.
                    pushed = git(root, "push", "origin", f"{commit}:refs/heads/main", check=False)
                    if pushed.returncode == 0:
                        print("Sito pubblicato.", flush=True)
                        return attempt
                    current = latest_main(root)
                    if git(root, "merge-base", "--is-ancestor", commit, current, check=False).returncode == 0:
                        print("Pubblicazione già ricevuta da GitHub.", flush=True)
                        return attempt
                    if current == base:
                        raise PublicationError(pushed.stderr.strip() or "GitHub ha rifiutato la pubblicazione")
            finally:
                git(root, "worktree", "remove", "--force", str(worktree))
        if attempt < max_attempts:
            print("Nuove modifiche ricevute: rigenero automaticamente dalla versione aggiornata.", flush=True)
            time.sleep(min(retry_delay * attempt, 10))
    raise PublicationError(f"main continua a cambiare dopo {max_attempts} tentativi; nessuna modifica concorrente è stata sovrascritta")


def publish_hero(worktree: Path) -> None:
    import base64
    import hashlib
    pending = worktree / "gallery/inbox/hero-publication-20261022"
    manifest_path = pending / "manifest.json"
    if not manifest_path.is_file():
        return
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    def target(relative: str) -> Path:
        path = (worktree / relative).resolve()
        if not path.is_relative_to(worktree.resolve()):
            raise PublicationError("Percorso media non valido")
        return path
    def object_sha(path: Path) -> str | None:
        if not path.is_file():
            return None
        value = path.read_bytes()
        return hashlib.sha1(b"blob " + str(len(value)).encode() + b"\0" + value).hexdigest()
    for edit in data["textFiles"]:
        if object_sha(target(edit["path"])) != edit["expected"]:
            raise PublicationError("Modifica concorrente da preservare: " + edit["path"])
    for entry in data["deletes"]:
        if object_sha(target(entry["path"])) != entry["sha"]:
            raise PublicationError("Media modificato nel frattempo: " + entry["path"])
    publisher = target("scripts/publish_site.py")
    if object_sha(publisher) != data["temporaryPublisherSha"]:
        raise PublicationError("Il publisher e cambiato durante il caricamento")
    encoded = "".join((pending / name).read_text(encoding="utf-8") for name in data["parts"])
    video = base64.b64decode(encoded, validate=True)
    if hashlib.sha256(video).hexdigest() != data["videoSha256"]:
        raise PublicationError("Checksum video non valido")
    media = target("assets/videos")
    media.mkdir(parents=True, exist_ok=True)
    (media / "hero-landscape.mp4").write_bytes(video)
    (media / "hero-landscape-poster.webp").write_bytes(base64.b64decode(data["poster"], validate=True))
    for entry in data["copies"]:
        target(entry["to"]).write_bytes(target(entry["from"]).read_bytes())
    for edit in data["textFiles"]:
        path = target(edit["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(edit["content"], encoding="utf-8", newline="")
    for entry in data["deletes"]:
        target(entry["path"]).unlink()
    publisher.write_text(data["originalPublisher"], encoding="utf-8", newline="")
    for name in [*data["parts"], "manifest.json"]:
        path = (pending / name).resolve()
        if path.parent != pending.resolve():
            raise PublicationError("Percorso temporaneo non valido")
        path.unlink()
    pending.rmdir()
    print("Video hero verificato e pubblicato; caricamenti temporanei rimossi.", flush=True)


def generate_site(worktree: Path, event_path: Path | None = None) -> None:
    publish_hero(worktree)
    # Drain accepted uploads before an issue can add HTML not yet in the catalog.
    subprocess.run([sys.executable, "-B", "scripts/gallery_publish.py"], cwd=worktree, check=True)
    if event_path:
        subprocess.run(
            [sys.executable, "-B", "scripts/gallery_request.py", "--event", str(event_path)],
            cwd=worktree, check=True,
        )
    subprocess.run([sys.executable, "-B", "scripts/optimize_images.py"], cwd=worktree, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("tools", "optimize", "issue"), required=True)
    parser.add_argument("--event", type=Path)
    args = parser.parse_args()
    event_path = args.event.resolve() if args.event else None
    marker = None
    message = "Pubblica gallerie da QUBLY Tools" if args.mode == "tools" else "Aggiorna automaticamente le varianti WebP"
    if args.mode == "issue":
        if not event_path:
            parser.error("--event è obbligatorio per le richieste GitHub")
        number = int(json.loads(event_path.read_text(encoding="utf-8"))["issue"]["number"])
        marker = f"Gallery-Request: issue/{number}"
        message = f"Aggiorna galleria dalla richiesta #{number}\n\nFixes #{number}"

    if (ROOT / "gallery/inbox/hero-publication-20261022/manifest.json").is_file():
        message = "Pubblica video hero PC e riordina varianti responsive"

    def generate(worktree: Path) -> None:
        generate_site(worktree, event_path if args.mode == "issue" else None)

    try:
        publish(ROOT, generate, message, marker=marker)
    except (PublicationError, subprocess.CalledProcessError) as error:
        print(f"::error::{error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()

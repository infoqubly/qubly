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


def generate_site(worktree: Path, event_path: Path | None = None) -> None:
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

    def generate(worktree: Path) -> None:
        generate_site(worktree, event_path if args.mode == "issue" else None)

    try:
        publish(ROOT, generate, message, marker=marker)
    except (PublicationError, subprocess.CalledProcessError) as error:
        print(f"::error::{error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()

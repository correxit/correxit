"""Preserve release snapshots and point latest at the newest stable version."""

import json
import os
from pathlib import Path
import re
from shutil import rmtree
from subprocess import CalledProcessError, check_call, check_output
from tempfile import TemporaryFile


def snapshot():
    root = Path(__file__).resolve().parent.parent
    os.chdir(root)
    version = json.loads(Path("package.json").read_text())["version"]
    versions = json.loads(check_output(["mike", "list", "--json"], text=True))
    output = root / "site" / "_pages"
    if output.exists():
        rmtree(output)

    if not any(item["version"] == version for item in versions):
        check_call(["mike", "deploy", version])

    stable = [
        item
        for item in {version, *(item["version"] for item in versions)}
        if re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", item)
    ]
    # A backport release or retry must not move latest to an older version.
    latest = max(
        stable, key=lambda item: tuple(map(int, item.split("."))), default=version
    )
    check_call(["mike", "alias", "--update-aliases", latest, "latest"])
    check_call(["mike", "set-default", "latest"])

    # Pages artifacts must contain real files, including the JupyterLite demo.
    tree = check_output(["git", "ls-tree", "-r", "gh-pages"], text=True)
    if any(line.startswith("120000 ") for line in tree.splitlines()):
        raise ValueError("The published website contains symbolic links")

    output.mkdir()
    with TemporaryFile() as archive:
        check_call(["git", "archive", "gh-pages"], stdout=archive)
        archive.seek(0)
        check_call(["tar", "-x", "-C", str(output)], stdin=archive)

    try:
        check_call(
            ["node", "--test", "site/test.mjs"],
            env={
                **os.environ,
                "MIKE_DOCS_VERSION": version,
                "CORREXIT_SITE_OUTPUT": str(output / version),
            },
        )
    except CalledProcessError:
        rmtree(output)
        raise


if __name__ == "__main__":
    snapshot()

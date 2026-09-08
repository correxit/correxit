"""Preserve release snapshots and allow independent homepage refreshes."""

from argparse import ArgumentParser
import json
import os
from pathlib import Path
import re
from shutil import rmtree
from subprocess import CalledProcessError, check_call, check_output
from tempfile import NamedTemporaryFile, TemporaryFile
from urllib.parse import urljoin

from mike.git_utils import Commit, FileInfo, GitEmptyCommit


def homepage(version, page=None):
    current = page is not None
    if page is None:
        page = check_output(["git", "show", f"gh-pages:{version}/index.html"], text=True)

    canonical = re.search(r'<link rel="canonical" href="([^"]*)"', page)[1]
    if not current:
        canonical = urljoin(canonical, "../")

    def resolve(value):
        assets = current and value.split("/")[0] in {"assets", "css", "js"}
        return urljoin("_home/" if assets else f"{version}/", value)

    def link(match):
        attribute, value = match.groups()
        if value == ".":
            value = "/"
        elif not re.match(r"(?:[a-z][a-z\d+.-]*:|/|#)", value, re.I):
            value = resolve(value)
        return f'{attribute}="{value}"'

    page = re.sub(r'\b(href|src)="([^"]*)"', link, page)
    page = re.sub(
        r'(<link rel="canonical" href="|<meta property="og:url" content=")[^"]*(")',
        lambda match: match[1] + canonical + match[2],
        page,
    )
    if current:
        page = re.sub(
            r'(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(")',
            lambda match: match[1]
            + urljoin(canonical, "_home/assets/correxit.png")
            + match[2],
            page,
        )

    def configuration(match):
        config = json.loads(match[2])
        config["base"] = f"{version}/"
        config["search"] = resolve(config["search"])
        return match[1] + json.dumps(config) + match[3]

    return re.sub(
        r'(<script id="__config"[^>]*>)(.*?)(</script>)', configuration, page
    )


def refresh(version):
    source = Path("site/_output")
    page = homepage(version, (source / "index.html").read_text())
    try:
        with Commit("gh-pages", "Refresh homepage from main") as commit:
            commit.delete_files(["_home"])
            commit.add_file(FileInfo("index.html", page))
            for directory in ["assets", "css", "js"]:
                for path in sorted((source / directory).rglob("*")):
                    if path.is_file():
                        commit.add_file(
                            FileInfo(
                                Path("_home") / path.relative_to(source), path.read_bytes()
                            )
                        )
    except GitEmptyCommit:
        pass


def snapshot(home=False):
    root = Path(__file__).resolve().parent.parent
    os.chdir(root)
    version = json.loads(Path("package.json").read_text())["version"]
    versions = json.loads(check_output(["mike", "list", "--json"], text=True))
    output = root / "site" / "_pages"
    if output.exists():
        rmtree(output)

    previous = next(
        (item["version"] for item in versions if "latest" in item["aliases"]), None
    )
    if not home and not any(item["version"] == version for item in versions):
        check_call(["mike", "deploy", version])

    stable = [
        item
        for item in {
            *([] if home else [version]),
            *(item["version"] for item in versions),
        }
        if re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", item)
    ]
    # A backport release or retry must not move latest to an older version.
    if home and not stable:
        raise ValueError("Publish a stable release before refreshing the homepage")
    latest = max(
        stable, key=lambda item: tuple(map(int, item.split("."))), default=version
    )
    if home:
        refresh(latest)
    else:
        check_call(["mike", "alias", "--update-aliases", latest, "latest"])
        try:
            page = check_output(["git", "show", "gh-pages:index.html"], text=True)
        except CalledProcessError:
            page = ""
        # Retries and backports must also preserve an independently refreshed home.
        if previous != latest or not page or 'http-equiv="refresh"' in page:
            with NamedTemporaryFile(mode="w", suffix=".html") as template:
                # Render stored text literally, including any Jinja syntax.
                template.write("{{ " + json.dumps(homepage(latest)) + " | safe }}")
                template.flush()
                check_call(
                    ["mike", "set-default", "latest", "--template", template.name]
                )

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
            [
                "node",
                "--test",
                *(["--test-name-pattern=the published root"] if home else []),
                "site/test.mjs",
            ],
            env={
                **os.environ,
                "MIKE_DOCS_VERSION": latest if home else version,
                "CORREXIT_SITE_OUTPUT": str(output / (latest if home else version)),
                "CORREXIT_HOMEPAGE": "1" if home else "",
            },
        )
    except CalledProcessError:
        rmtree(output)
        raise


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument(
        "--homepage", action="store_true", help="Refresh only the root homepage"
    )
    snapshot(home=parser.parse_args().homepage)

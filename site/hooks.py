import os
from pathlib import Path
from shutil import copytree, rmtree
from urllib.parse import urljoin

from mkdocs.plugins import event_priority


@event_priority(100)
def on_config(config, **_kwargs):
    # Mike's latest alias redirects HTML only; images need the numbered URL.
    version = os.environ.get("MIKE_DOCS_VERSION", "")
    config.extra["image"] = urljoin(
        config.site_url, f"{version}/assets/correxit.png".lstrip("/")
    )


def _remove(demo):
    """Remove the generated demo without following its development symlink."""

    if demo.is_symlink():
        demo.unlink()
    elif demo.exists():
        rmtree(demo)


def on_pre_build(config, **_kwargs):
    demo = Path(config.site_dir) / "demo"
    _remove(demo)


def on_post_build(config, **_kwargs):
    root = Path(__file__).resolve().parent.parent
    demo = Path(config.site_dir) / "demo"
    _remove(demo)

    lite = root / "lite" / "_output"
    if os.environ.get("MIKE_DOCS_VERSION"):
        copytree(lite, demo, symlinks=False)
    else:
        demo.symlink_to(lite, target_is_directory=True)

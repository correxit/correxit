import os
from pathlib import Path
from shutil import copytree, rmtree


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

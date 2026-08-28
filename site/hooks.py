import os
from pathlib import Path
from shutil import copytree, rmtree


def on_post_build(config, **_kwargs):
    root = Path(__file__).resolve().parent.parent
    demo = Path(config.site_dir) / "demo"
    if demo.is_symlink():
        demo.unlink()
    elif demo.exists():
        rmtree(demo)

    lite = root / "lite" / "_output"
    if os.environ.get("MIKE_DOCS_VERSION"):
        copytree(lite, demo, symlinks=False)
    else:
        demo.symlink_to(lite, target_is_directory=True)

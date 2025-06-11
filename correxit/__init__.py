try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings
    warnings.warn("Importing 'correxit' outside a proper installation.")
    __version__ = "dev"


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "correxit"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "correxit"
    }]


def _load_jupyter_server_extension(server_app):
    """Initializes correxit server extension.

    Parameters
    ----------
    server_app: jupyterlab.labapp.LabApp
        JupyterLab application instance
    """
    name = "correxit"
    server_app.log.info(f"Registered {name} server extension")

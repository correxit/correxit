# Correxit mark

The Correxit mark is a corrected notebook cell with a secondary `CXT`
reading. Its four horizontal terminals share the same 44-unit measure. The
vermilion tick is the primary reading; the single navy continuation quietly
completes the middle `X`. A deliberate break above the lower-right terminal
keeps the `T` distinct while the aligned terminal completes the notebook cell.

## Assets

- `correxit-mark-on-light.svg`: full-colour mark for light backgrounds.
- `correxit-mark-on-dark.svg`: full-colour mark for dark backgrounds.
- `correxit-mark-monochrome.svg`: portable single-colour master. Its root
  `color` is a fallback and may be overridden when the SVG is inline.
- `correxit-mark-jupyter.svg`: two-colour LabIcon. Structural strokes use
  JupyterLab's `jp-icon3` theme class; the vermilion tick remains stable.
- `correxit-mark-jupyter-monochrome.svg`: LabIcon for surfaces that require
  every stroke to follow the active JupyterLab theme.

The light palette is navy `#003660` and vermilion `#ef5b45`. The dark variant
changes only the structural strokes to `#f4f7f9`, preserving the brand accent.
Do not encode state with these colours: the mark is fully legible in one
colour.

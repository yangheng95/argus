# Coding CLI Icon Token Source

Date: 2026-06-18

## Problem

Coding CLI (Command Line Interface) launcher icons have two competing color
sources. `conversation.css` assigns Coding CLI icon colors through semantic and
brand tokens, but several custom SVG paths in `Icon.tsx` still hard-code their
own palette. The visible result is controlled by the SVG attribute instead of
the launcher token contract.

## Recall

| Source                                                     | Existing decision                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-18-workspace-split-launcher-button-primitive.md`  | Terminal, editor, and Coding CLI launchers share the `Button` primitive; local chrome must not own focus or operation styling. |
| `2026-06-18-popup-contrast-light-palette.md`               | Popup and launcher colors must be corrected at the shared token source rather than component-local overrides.                  |
| `Icon.tsx` header comment                                  | Callers use the shared Icon primitive instead of writing inline SVG; custom SVG is allowed only for product-specific glyphs.   |
| `.workspace-coding-cli-*-icon[data-coding-cli-icon]` rules | Coding CLI brand colors are already declared in CSS as the launcher-level source of truth.                                     |

## Evidence Sweep

| Sweep                        | Result                                                                                    | Decision                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `rg -n "coding-claude-code   | coding-gemini                                                                             | coding-glm" packages/overlay/src packages/overlay/test specs`                                | `WorkspaceCodingCliLaunchers` maps CLI profile icons to Icon names, and `editor-brand-icons.test.ts` currently locks the hard-coded palette into place. | Update the icon test contract to preserve glyph shape while requiring token-driven color. |
| `rg -n "oc-brand-claude-code | oc-brand-gemini                                                                           | workspace-coding-cli" packages/overlay/src/styles`                                                    | CSS already maps Claude Code and Gemini to brand tokens and GLM to `--text-strong`.                                                                     | Keep CSS as the single visible color source.                                              |
| `Icon.tsx` inspection        | Claude Code uses `#D97757`, Gemini uses `#8E75B2`, and GLM uses `#2D2D2D` plus `#FFFFFF`. | Replace CLI foreground fills with `currentColor`; use an existing surface token for GLM cutout paths. |

## Fix

- Keep the official product glyph paths.
- Route Claude Code and Gemini icon fill through `currentColor`.
- Route GLM foreground through `currentColor` and its reverse/cutout detail
  through the existing `--surface` token.
- Update static icon tests so Coding CLI icon shape remains locked while raw
  Coding CLI palette values are forbidden.
- Extend the browser launcher test to render all Coding CLI options and assert
  that computed SVG fill follows the launcher token color.

## Acceptance

- `coding-claude-code`, `coding-gemini`, and `coding-glm` have no raw palette
  hex values in their SVG definitions.
- CSS token rules remain the only source for Coding CLI icon color.
- Browser evidence proves Claude Code and Gemini fills follow brand token
  overrides, and GLM foreground follows `--text-strong`.
- The workspace launcher screenshot includes all Coding CLI icons and remains
  visually legible.

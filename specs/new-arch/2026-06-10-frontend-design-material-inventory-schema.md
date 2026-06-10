# Frontend Design Material Inventory Schema

## Evidence

| Surface | Finding | Action |
| --- | --- | --- |
| `packages/opencorvus/src/frontend-design/schema.ts` | `material_inventory` and `material_inventory_items` already exist, but both default to empty values in the terminal tool input schema. The final assertion rejects an empty rendered inventory only after tool execution. | Make the structured inventory items explicit in schema so the provider sees the required field before calling `submit_frontend_template`. |
| `packages/opencorvus/src/frontend-design/output-tools.ts` | The renderer already materializes `material_inventory` from `material_inventory_items`. | Reuse the existing renderer as the single canonical markdown projection. |
| `packages/opencorvus/src/prompt/core/frontend-design-core.txt` | Prompt asks for `material_inventory` and recommends compact `material_inventory_items`. | Keep prompt semantics; schema should carry the hard data-shape requirement. |
| `packages/opencorvus/test/frontend-design/*` | Existing tests cover compact rendering, provider schema compactness, and direct submit calls. | Update focused tests so at least one material inventory item is required and rendered. |

## Design

- Add a dedicated material inventory item schema with compact required fields: `title`, `detail`, `source_refs`.
- Use `.min(1)` for `material_inventory_items` in the terminal tool input schema.
- Use the same item shape in the final schema so the required material list remains part of the persisted contract.
- Keep `material_inventory` as the rendered canonical markdown field; do not add fallback paths or alternate sources.

## Verification

- Run focused frontend-design schema/output tests.
- Run typecheck for the touched package if focused tests pass.

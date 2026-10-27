# Upstream Dependencies

The upstream repositories are cloned locally under `opensource/` for development and are not uploaded as nested Git repositories.

| Repository | Purpose | Boundary |
| --- | --- | --- |
| `KKKKhazix/AIHOT` | AI information engine and public read API | The app reads its public HTTP API only |
| `aliahamme45678-jpg/douyin-material-pipeline` | Douyin material collection and import source | Login state and generated outputs stay local |
| `aliahamme45678-jpg/Chzhinan` | Writing distillation and rewrite reference | Original author material is not uploaded automatically |
| `dontbesilent2025/dbskill` | Optional content diagnostic methods | CC BY-NC 4.0; the app labels local compatibility rules separately and does not claim to execute the original Skill |

Private Studio material is stored in the Studio data layer and is never written into AIHOT public tables or API output.

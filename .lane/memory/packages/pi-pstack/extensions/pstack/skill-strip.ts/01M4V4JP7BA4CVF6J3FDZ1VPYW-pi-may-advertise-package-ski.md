---
id: 01M4V4JP7BA4CVF6J3FDZ1VPYW
anchor: function stripSkillsByLocationPrefix
created: 2026-10-13T17:22:18Z
norm: '1'
sig: 496308a6b4da69a1
body_hash: b77b71f8678798c8
raw_hash: 53b45b8cf465e952
lines: 41-100
---

Pi may advertise package skills through shared-directory symlinks. Compare canonical paths when both exist; lexical fallback is for ENOENT/ENOTDIR only, not permission or other filesystem errors.

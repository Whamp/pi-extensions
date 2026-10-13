# Cursor Pstack 0.15.15 caller-guidance fixture

Source: https://github.com/cursor/plugins/tree/df581122cde17e6e27686b5a448bde23e4ad4318/pstack

This fixture vendors the upstream caller-guidance subset used by the importer regression tests. It is not the complete upstream package. The regeneration test compares adapted caller guidance with the shipped Pi files and preserves Pi-owned overlays. The older 12d587d fixture remains historical evidence.

The complete package was refreshed from this revision. Pi model defaults remain `inherit-parent`; Cursor model slugs are translated, not adopted as spending policy. BB guidance and Pi-native help are protected overlays.

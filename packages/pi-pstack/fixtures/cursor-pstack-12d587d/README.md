# Cursor pstack caller-guidance fixture

This fixture intentionally vendors only the upstream caller-guidance files adapted by `reground-from-cursor.mjs`.

Source: `cursor/plugins` commit `12d587dfb20741cafc376c42c696c5f6e2a64487`.

Update the fixture only when the package intentionally moves to a new upstream revision. The regeneration test compares every generated caller-guidance file with its shipped Pi counterpart.

---
"@whamp/pi-pstack": patch
---

Hide package-owned skills advertised through shared filesystem symlinks when Pstack is off. Resolve existing skill locations and the package skill root before filtering, while retaining lexical matching for missing synthetic paths.

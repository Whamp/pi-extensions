# Changelog

## 0.0.1

### Patch Changes

- 9afa9b6: Add inline skill, agent, and prompt references in one request. Enable sticky Poteto Mode when a complete `$poteto-mode` token appears anywhere in user input.

## 0.0.0

- Port inline skill, named-agent, prompt-template, autocomplete, and editor coloring behavior from upstream `@pi-kaush/pi-inline-identifier` revision `d59aab65b94328071b8bcd936b7cd87584723715`.
- Compose distinct recognized references in source order with the original request at the tail; retain native expansion for one skill.
- Enable sticky Poteto Mode from a complete inline `$poteto-mode` token in user input.

# Security policy

## Supported versions

This personal fork supports the current versions on its default branch for:

- `@zenspc/pi-pstack`
- `@zenspc/pi-quiet`

Older revisions do not receive backports unless a release note says otherwise.

## Report a vulnerability

Report security issues privately. Do not open a public issue for
vulnerabilities, secrets, or token leaks.

1. Use
   [GitHub Private Vulnerability Reporting](https://github.com/Whamp/pi-extensions/security/advisories/new)
   when it is enabled.
2. Otherwise contact [@Whamp](https://github.com/Whamp) privately through
   GitHub.

Include the affected package and revision, impact, minimal reproduction steps
or proof of concept, and whether the issue is already public.

The maintainer will acknowledge private reports and coordinate disclosure.

## Bad published versions

If a published package version is broken or unsafe, publish a fixed version.
Npm limits unpublishing after a short window. Deprecate the bad version with:

```bash
npm deprecate @zenspc/<pkg>@<ver> "reason; use @zenspc/<pkg>@X.Y.Z"
```

If a package leaked tokens or secrets, rotate the credentials and report the
leak through the private channel above.

## Public reports

Redact tokens, credentials, private paths, and session content before attaching
logs or output to a public issue. Report unintended disclosure through the
private channel above.

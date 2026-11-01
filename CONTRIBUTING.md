# Contributing to KiloMita

Thanks for helping make internet speed in Nigeria easier to see and compare.

## Setup

You need Bun 1.4.4 and Node.js 20.9 or newer (see [README.md](README.md#requirements)).

```sh
bun install
bun run dev
```

Before opening a pull request, run:

```sh
bun run typecheck && bun run lint && bun run format:check && bun run test
```

A pre-commit hook (Husky + lint-staged) formats and lints staged files for you.

## Conventions

- TypeScript only. No JavaScript files anywhere in the repo, including config files.
- No `src/` directories. Next.js uses the App Router only (`apps/web/app/`), never `pages/`.
- `packages/engine` must stay framework-agnostic: no React, React DOM or Next.js imports. ESLint enforces this.
- Keep the product name in `packages/shared/brand.ts`. Do not hard-code it elsewhere.
- Do not add facts about ISPs, ASNs or third-party APIs without a verifiable source linked in the code.
- Prefer simple code. Comments only where the reason is not obvious from the code.
- Every new dependency must pass `bun run licenses`. Ask in an issue before adding a heavy dependency or any paid service.
- Never commit secrets, raw IP addresses or other personal data.

## Licensing of contributions

KiloMita is licensed under the [GNU AGPL v3.0 only](LICENSE). By contributing, you agree that your contribution is licensed under the same terms (inbound = outbound). There is no CLA.

### Developer Certificate of Origin (DCO)

Every commit must be signed off, certifying the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

```sh
git commit -s -m "Your message"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line. A CI check rejects pull requests with unsigned commits.

The sign-off is a statement by a **person** that they have the right to submit the code. If an AI coding agent prepared a commit, the human submitting it reviews it and signs it off. An agent must never add a `Signed-off-by` line on anyone's behalf.

## Reporting bugs and security issues

- Bugs and ideas: open an issue using the templates.
- Security vulnerabilities: do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

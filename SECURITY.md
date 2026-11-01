# Security policy

## Reporting a vulnerability

Please report security vulnerabilities privately through GitHub:

1. Go to <https://github.com/kleenpulse/kilomita/security>.
2. Click **Report a vulnerability**.
3. Describe the issue, how to reproduce it, and its impact.

Do not open a public issue or pull request for a vulnerability until a fix is released.

We aim to acknowledge reports within 7 days and will keep you updated until the issue is resolved. We are happy to credit you in the release notes unless you prefer otherwise.

## Scope

In scope: the code in this repository and any official KiloMita deployment.

Of particular interest:

- Any way to read, link or de-anonymise stored test results, or recover IP addresses
- Bypassing consent, rate limits or test-token checks
- Injection, XSS or supply-chain issues in the build

## Supported versions

KiloMita is pre-1.0. Only the latest commit on `main` receives security fixes.

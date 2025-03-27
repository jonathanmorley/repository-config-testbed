# Repository Config Testbed

It is not always obvious what the effect of GitHub repository configuration is.

This repository contains test cases for various GitHub Repository Configurations, so that these effects are documented.

## Test Suites

### Checks

This tests the effect of check status and conclusion on a ruleset configured to require a status check.

Based on the [test snapshots](./tests/__snapshots__/checks.test.ts.snap), we can see that:

- `conclusion`s in `['neutral', 'skipped', 'success']` are treated as `truthy`
- Other `conclusion`s are treated as `falsey`
- Check `status` does not affect how the ruleset treats the check.

### Reviews

This tests the effect of the `pull_request` ruleset parameters.

Based on the [test snapshots](./tests/__snapshots__/reviews.test.ts.snap), we can see that:

- With either of `dismiss_stale_reviews_on_push` and `require_last_push_approval` set, commits that change the diff of the PR will invalidate prior approvals.
- With `require_last_push_approval` set, users cannot 'sneak in' changes, by pushing to a pull request, then approving that pull request.

## Running Locally

Some tests require multiple users (e.g. to open and approve PRs), some tests require GitHub apps (e.g. to send status checks).

To run the app locally, use the following command:

```
GITHUB_APP_PRIVATE_KEY=$(cat ~/Downloads/repository-config-tester.2025-03-14.private-key.pem) GITHUB_TOKEN=$(gh auth token --user=jonathanmorley) pnpm vitest run
```

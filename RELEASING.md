# Releasing

`@rodrigocoliveira/mobile-app-bridge` is published to npm from GitHub Actions. After the first release, nobody publishes from a laptop.

No npm token is stored anywhere. npm trusts this repository's `release.yml` workflow directly (OIDC "trusted publishing"), and every published version carries a provenance attestation.

## Day-to-day: how a change reaches npm

1. **Every PR that changes the package ships a changeset.**
   - Run `bun run changeset`.
   - Pick the bump (`patch` / `minor` / `major`).
   - Write the one-paragraph note users will read in the CHANGELOG.
   - Commit the generated `.changeset/*.md` with the PR.
   - A PR that only touches docs, the example or CI needs no changeset.
2. **Merge the PR.** The Release workflow opens (or updates) a PR titled **"chore: version packages"**. It bumps `package.json`, regenerates `bun.lock` and writes the CHANGELOG.
3. **Review and merge the version PR** when you want to cut a release. CI does not run on it: GitHub does not trigger workflows for PRs opened with the Actions token. It only changes versions and the CHANGELOG, and the same code already passed CI on `main`. The workflow then builds, runs `check:dist`, runs `changeset publish`, pushes the git tag and creates a GitHub release.

## Versioning policy

Before 1.0:
- use `minor` for anything that changes a public signature or behavior;
- use `patch` for everything else.

Never change the shape of an existing bridge method in a way that breaks old app builds. Add a new method name instead. App binaries in the stores lag behind the web.

## What guards the release

| Guard | Where |
|---|---|
| Unit tests, typecheck, build, and "`/web` has no native imports" | `ci.yml` on every PR and on `main` |
| Human review of versions and CHANGELOG before publishing | the version PR |
| No long-lived npm credential | trusted publishing (OIDC), `permissions: {}` by default |
| Only `dist/`, `README.md`, `LICENSE` in the tarball | `files` in `package.json`; check with `npm pack --dry-run` |

## One-time setup (first release)

npm only lets you add a trusted publisher to a package that already exists, so the very first version is published by hand, once.

1. **Create the GitHub repo** `rodrigocoliveira/mobile-app-bridge` and push `main`.
2. **Repository setting:** GitHub → Settings → Actions → General → enable *Allow GitHub Actions to create and approve pull requests*.
3. **Merge the first version PR.** The workflow opens it: `0.0.0 → 0.1.0` from `.changeset/initial-release.md`. The publish job will fail once with an npm auth error. That is expected, because the trusted publisher does not exist yet.
4. **Publish 0.1.0 from your machine.** Use an npm account with 2FA enabled.

   ```bash
   git checkout main && git pull
   npm login
   bun install && bun run release
   git push --follow-tags
   ```

5. **Add the trusted publisher** on npmjs.com → package → Settings → *Trusted Publisher* → GitHub Actions:

   | field | value |
   |---|---|
   | Organization or user | `rodrigocoliveira` |
   | Repository | `mobile-app-bridge` |
   | Workflow filename | `release.yml` |
   | Environment | leave empty |
   | Allow `npm publish` | **checked**. Unchecked means stage-only, and `changeset publish` (a plain `npm publish`) is rejected. |
   | Allow `npm dist-tag` | unchecked |

6. **Lock it down.** On the same page, set *Publishing access* to *Require two-factor authentication and disallow tokens*.

## Manual fallback

```bash
bun run version          # apply changesets, bump version, refresh bun.lock, write CHANGELOG
git commit -am "chore: version packages"
bun run release          # build + check:dist + changeset publish (asks for the 2FA code)
git push --follow-tags
```

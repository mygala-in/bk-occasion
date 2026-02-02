# Pre-Public Repository Checklist

Use this checklist before making the repository public.

## 🚨 CRITICAL (MUST DO IMMEDIATELY)

- [ ] **Revoke the exposed GitHub Personal Access Token**
  - Token prefix: `ghp_LmSl9`
  - Location: Settings → Developer settings → Personal access tokens
  - The token was found in `.gitmodules` (commit a9e888c from July 2025)
  - Even though it's removed from current code, it's still in git history

## 🔒 Security Verification

- [ ] Verify `bk-config` repository is set to **PRIVATE**
- [ ] Verify `bk-utils` repository is set to **PRIVATE**
- [ ] Ensure no secrets are in `bk-config` configs files
- [ ] Ensure no secrets are in `bk-utils` shared utilities
- [ ] Review commit history for any other sensitive data
- [ ] Update any CI/CD secrets in GitHub Actions

## 📝 Repository Configuration

- [ ] Update repository description on GitHub
- [ ] Add relevant topics/tags (e.g., serverless, aws, lambda, nodejs)
- [ ] Enable GitHub security features:
  - [ ] Dependabot alerts
  - [ ] Dependabot security updates
  - [ ] Secret scanning
  - [ ] Code scanning (CodeQL)
- [ ] Configure branch protection for `main` branch
- [ ] Set up required reviewers (if applicable)

## 📚 Documentation Review

- [ ] Review SECURITY.md and update contact information
- [ ] Verify README.md has accurate information
- [ ] Check LICENSE file is appropriate
- [ ] Review CONFIGURATION.md for completeness
- [ ] Add CONTRIBUTING.md (optional but recommended)

## 🔍 Final Security Checks

- [ ] Search for any TODO/FIXME comments that mention secrets
- [ ] Verify all environment variables are documented
- [ ] Ensure no hardcoded URLs to internal systems
- [ ] Check that all API endpoints are intentionally public
- [ ] Review if domain names in serverless.yml should be public

## 🎯 Post-Public Actions

After making the repository public:

- [ ] Monitor for GitHub security alerts
- [ ] Set up notifications for new issues/PRs
- [ ] Announce the open-sourcing (if applicable)
- [ ] Update any documentation that references the repo
- [ ] Consider adding badges to README (build status, license, etc.)

## ℹ️ Important Notes

1. **Git History**: The token in commit a9e888c will be visible in git history even after it's revoked. This is why revoking it is critical.

2. **Submodules**: The repository depends on private submodules. Users who fork/clone won't have access to:
   - `bk-config` (contains environment configs)
   - `bk-utils` (contains shared utilities)
   
   This means the repository won't work out-of-the-box for external users unless you provide alternatives.

3. **Configuration**: External users won't be able to deploy without access to the config files referenced in `serverless.yml`.

## 📞 Questions?

If you have questions about any of these items, refer to:
- `SECURITY_REVIEW.md` - Detailed security findings
- `SECURITY.md` - Security policy and reporting
- `CONFIGURATION.md` - Environment setup guide

---

**Last Updated:** February 2, 2026  
**Status:** Ready for review, pending critical actions

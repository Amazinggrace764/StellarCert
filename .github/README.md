# GitHub Actions Workflows

This repository includes comprehensive GitHub Actions workflows for continuous integration and deployment.

## Workflows Overview

### 1. Main CI/CD Pipeline (`.github/workflows/ci.yml`)

The main CI/CD pipeline runs on every push and pull request to `main` and `develop` branches.

#### Jobs:

- **Lint and Type Check**: Runs linting and type checking for frontend and backend
- **Build**: Builds all three components (frontend, backend, contracts)
- **Test**: Runs unit and integration tests
- **Security Scan**: Performs security audits on all components
- **Docker Build**: Builds Docker images for frontend and backend
- **Deploy Preview**: Deploys to preview environment for pull requests

#### Commands Available:

```bash
# Run linting across all components
npm run lint

# Run type checking
npm run typecheck

# Run all tests
npm run test

# Build all components
npm run ci:build

# Security audit
npm run security:audit
```

### 2. Stellar Contracts CI/CD (`.github/workflows/contracts.yml`)

Specialized workflow for Stellar smart contracts, triggered when contract files change.

#### Jobs:

- **Contract Linting**: Runs Rust clippy and fmt checks
- **Contract Testing**: Runs unit, integration, and contract tests
- **Contract Build**: Builds contracts in release mode
- **Contract Deploy**: Deploys contracts to Stellar network (main branch only)
- **Security Scan**: Runs cargo-audit and cargo-deny for security

#### Commands Available:

```bash
# Lint contracts
npm run lint:contracts

# Test contracts
npm run test:contracts

# Build contracts
npm run build:contracts
```

## Usage

### Local Development

You can run the same commands locally that the CI/CD pipeline uses:

```bash
# Check everything before committing
npm run ci:check

# Build everything
npm run ci:build

# Run security audit
npm run security:audit
```

### Environment Variables

For contract deployment, the following secrets are required:

- `STELLAR_SECRET_KEY`: Stellar account secret key for deployment
- `STELLAR_NETWORK_PASSPHRASE`: Network passphrase (Testnet/Public)

### Branch Protection

- Main branch: Requires passing CI checks before merge
- Develop branch: Used for feature integration
- Pull requests: Trigger full CI pipeline

## Workflow Triggers

### Main CI/CD Pipeline

- **Push**: `main`, `develop` branches
- **Pull Request**: `main`, `develop` branches

### Contracts Pipeline

- **Push**: `main`, `develop` branches (when `stellar-contracts/**` files change)
- **Pull Request**: `main`, `develop` branches (when `stellar-contracts/**` files change)

## Artifacts

The workflows generate the following artifacts:

- `frontend-build`: Built frontend files
- `backend-build`: Built backend files
- `stellar-contracts`: Compiled contract binaries

## Security

Security scanning includes:

- **npm audit**: Checks for known vulnerabilities in Node.js dependencies
- **cargo audit**: Checks for known vulnerabilities in Rust dependencies
- **cargo-deny**: Enforces security policies for Rust dependencies

## Deployment

### Preview Environment

- Automatically deployed for pull requests
- URL provided in GitHub Actions summary

### Production Deployment

- Triggered on push to `main` branch
- Deploys contracts to Stellar network
- Updates Docker images

## Troubleshooting

### Common Issues

1. **Lint Failures**: Run `npm run lint` locally to fix issues
2. **Type Errors**: Run `npm run typecheck` to identify type issues
3. **Test Failures**: Run `npm test` to debug failing tests
4. **Security Vulnerabilities**: Review `npm audit` output and update dependencies

### Debugging Workflows

1. Check GitHub Actions logs for detailed error messages
2. Run the same commands locally to reproduce issues
3. Use `actions/checkout@v4` to ensure proper code checkout
4. Verify environment variables and secrets are properly configured

## Best Practices

1. **Commit Messages**: Use descriptive commit messages
2. **Pull Requests**: Create focused PRs with clear descriptions
3. **Testing**: Ensure all tests pass before merging
4. **Security**: Address security vulnerabilities promptly
5. **Documentation**: Update this README when workflows change

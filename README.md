# bk-occasion

MyGala backend service for occasions-related APIs.

## Description

This is a serverless backend service built with AWS Lambda and the Serverless Framework. It provides APIs for managing occasions, events, RSVPs, and related functionality.

## Features

- Occasion management (create, update, delete, list)
- Event management within occasions
- RSVP handling
- User management for occasions
- Asset management
- Vendor integration

## Prerequisites

- Node.js 16.x or higher
- AWS CLI configured
- Serverless Framework

## Installation

```bash
npm install
```

## Development

```bash
# Run locally
npm run local

# Lint code
npm run lint

# Fix linting issues
npm run lint-fix
```

## Deployment

```bash
# Deploy to dev
npm run dev-deploy

# Deploy to prod
npm run prod-deploy
```

## Configuration

This service uses configuration files from the `bk-config` submodule. Ensure you have the proper environment configuration files before deploying.

## License

ISC - See LICENSE file for details

## Security

Please see [SECURITY.md](SECURITY.md) for information about reporting security vulnerabilities.

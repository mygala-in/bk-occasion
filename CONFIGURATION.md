# Environment Variables

This service requires the following environment variables to be configured through the `bk-config` submodule.

## Required Configuration Files

- `bk-config/configs.dev.json` - Development environment configuration
- `bk-config/configs.prod.json` - Production environment configuration
- `bk-config/envs.dev.json` - Development environment variables
- `bk-config/envs.prod.json` - Production environment variables

## Configuration Structure

### configs.{stage}.json
```json
{
  "envPrefix": "dev|prod",
  "awsRegion": "ap-south-1",
  "awsAccountId": "YOUR_AWS_ACCOUNT_ID",
  "lambdaRole": "arn:aws:iam::ACCOUNT_ID:role/lambda-role",
  "securityGroup": "sg-xxxxx",
  "subnet1": "subnet-xxxxx",
  "subnet2": "subnet-xxxxx",
  "subnet3": "subnet-xxxxx"
}
```

### envs.{stage}.json
```json
{
  "STAGE": "dev|prod",
  "LOG_LEVEL": "info|debug",
  // Add other environment-specific variables here
}
```

## Security Notes

⚠️ **NEVER commit sensitive configuration files to the repository**

- Use the private `bk-config` repository for sensitive configurations
- Ensure all secrets and credentials are stored securely
- Use AWS Systems Manager Parameter Store or Secrets Manager for production secrets

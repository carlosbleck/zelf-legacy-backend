# Cron Job Setup for Expired Vault Notifications

This system automatically checks for expired inheritance vaults and sends email notifications to beneficiaries.

## How It Works

1. **Cron Endpoint**: `GET /api/cron/check-expired-vaults`
   - Scans all vaults in the Solana program
   - Identifies vaults where `current_time > last_ping + timeout_secs`
   - Sends compassionate email notifications to beneficiaries
   - Tracks which vaults have been notified (stored in `data/notifications.json`)

2. **Email Template**: When a vault expires, beneficiaries receive an email with:
   - Subject: "🕊️ Inheritance Available - Zelf Legacy"
   - Message: "We are very sorry for your loss. An inheritance plan has been created for you, and you can now access its assets."
   - Step-by-step instructions to claim the inheritance
   - The tagName needed for retrieval

## Setup Options

### Option 1: External Cron Service (Recommended for Production)

Use a service like **cron-job.org**, **EasyCron**, or **UptimeRobot**:

1. Sign up for a free cron service
2. Create a new job with:
   - URL: `https://your-backend-url.com/api/cron/check-expired-vaults`
   - Method: GET
   - Schedule: Every 6-24 hours (e.g., `0 */12 * * *` for every 12 hours)

### Option 2: Railway/Render Cron (if deployed there)

If deployed on Railway or Render, add a cron job in your deployment settings:

```yaml
# railway.toml or render.yaml
crons:
  - name: check-expired-vaults
    schedule: "0 */12 * * *"  # Every 12 hours
    command: "curl http://localhost:3000/api/cron/check-expired-vaults"
```

### Option 3: System Crontab (Linux/Mac)

Edit your crontab:

```bash
crontab -e
```

Add this line (runs every 12 hours):

```
0 */12 * * * curl http://localhost:3000/api/cron/check-expired-vaults
```

### Option 4: GitHub Actions (Free)

Create `.github/workflows/cron.yml`:

```yaml
name: Check Expired Vaults
on:
  schedule:
    - cron: '0 */12 * * *'  # Every 12 hours
  workflow_dispatch:  # Allow manual trigger

jobs:
  check-vaults:
    runs-on: ubuntu-latest
    steps:
      - name: Call Cron Endpoint
        run: |
          curl -X GET https://your-backend-url.com/api/cron/check-expired-vaults
```

## Testing

### Manual Test

You can manually trigger the cron job to test it:

```bash
curl http://localhost:3000/api/cron/check-expired-vaults
```

Expected response:

```json
{
  "success": true,
  "summary": {
    "totalVaults": 5,
    "expiredVaults": 2,
    "newlyNotified": 1,
    "newlyExpiredVaults": [
      {
        "vaultAddress": "Da9E27sj7xXhCTfJ98w4zvavxn1vxWwGrJVgUCM3iCQD",
        "beneficiaryEmail": "beneficiary@example.com",
        "testator": "29oa5bJWcVFTe9SxxJDHtn3b5Ao1KaccjxviaQSWNivf",
        "beneficiary": "D2UrC1pPqvpQEzWdDzj7DcGaEmz3nbMQsi4fYw2Z1FEr"
      }
    ]
  },
  "timestamp": "2026-01-31T18:00:00.000Z"
}
```

### Check Notification Status

View which vaults have been notified:

```bash
curl http://localhost:3000/api/cron/notification-status
```

## Notification Tracking

The system uses `data/notifications.json` to track which vaults have been notified:

```json
{
  "Da9E27sj7xXhCTfJ98w4zvavxn1vxWwGrJVgUCM3iCQD": {
    "notifiedAt": "2026-01-31T18:00:00.000Z",
    "beneficiaryEmail": "beneficiary@example.com",
    "vaultAddress": "Da9E27sj7xXhCTfJ98w4zvavxn1vxWwGrJVgUCM3iCQD"
  }
}
```

This ensures each beneficiary only receives ONE email notification, even if the cron job runs multiple times.

## Recommended Schedule

- **Development**: Every 1 hour for testing
- **Production**: Every 12-24 hours

## Important Notes

1. **Email Requirement**: Vaults must have a beneficiary email stored to receive notifications
2. **One-Time Notification**: Each vault is only notified once (tracked in `notifications.json`)
3. **Sandbox Mailgun**: Remember to add verified recipients in Mailgun dashboard if using sandbox domain
4. **Backup**: Consider backing up `data/notifications.json` periodically

## Monitoring

Check the server logs to see cron job activity:

```
🔍 Cron Job: Checking for expired vaults...
   Found 5 vault(s)
   ⏰ Expired vault found: Da9E27sj7xXhCTfJ98w4zvavxn1vxWwGrJVgUCM3iCQD
      Beneficiary: D2UrC1pPqvpQEzWdDzj7DcGaEmz3nbMQsi4fYw2Z1FEr
      Email: beneficiary@example.com
      Time since last ping: 45 days
      ✅ Email sent to beneficiary@example.com

✅ Cron job completed:
   Total vaults: 5
   Expired vaults: 2
   Newly notified: 1
```

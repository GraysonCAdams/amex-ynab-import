# AMEX YNAB Import

⚠️ **If you use this, unlink your accounts on YNAB first, otherwise Plaid may add duplicates.**

Unreliable connections over the course of the last few years means taking matters into our own hands. Other tools I found are still a bit of a manual process, downloading CSV's or QFX files and converting them to then upload them. This tool is meant to go the whole nine yards, and do every step for you with just one command.

```
$ npm run start

> start
> node --no-warnings=ExperimentalWarning --import=./logError.js --loader ts-node/esm index.ts

Found YNAB accounts:
 - Venmo
 - Checking
 - Savings
 - Blue Business Plus
 - Gold
 - Charles Schwab Platinum
 - Amazon

Going to American Express to fetch your CSV files and match to YNAB accounts by name
Pulling up American Express...
Filling login credentials...
Submitting...
Opting out of mobile push notification...
Waiting for OTP prompt... (will choose email)
Connecting to mail server...
Successfully connected to mail server!
Opening mailbox...
Mailbox opened
Clicking the "Email" OTP button...
Watching for new emails...
1 new email(s), scanning contents...
Found the OTP email
Discarded email now that it's cached
Found accounts: Blue Business Plus, Charles Schwab Platinum, Gold
[..] Fetching Blue Business Plus CSV
[✓] Fetched Blue Business Plus CSV
[..] Fetching Charles Schwab Platinum CSV
[✓] Fetched Charles Schwab Platinum CSV
[..] Fetching Gold CSV
[✓] Fetched Gold CSV
Charles Schwab Platinum may have some transactions imported
Gold may have some transactions imported
Importing 22 transactions to YNAB (it will ignore duplicate imports, so actual amount may differ)
All done. Until next time! 👋
```

When you run this script, it:

1. Logs into YNAB (API) and fetches your accounts and last reconciled dates
2. Logs into American Express (Puppeteer) and performs the One-Time Password process automatically (uses IMAP)
3. Fetches CSV data from American Express
4. Converts it into zero duplicate, YNAB format and imports through YNAB API

Being zero input and stateless, this script requires your YNAB AMEX accounts to be named the same as on American Express. It will tell you what it was unable to map so you can make the adjustments... or, fork your own version of this and allow for user input.

## Required Environment Variables

You must supply the variables below. The budget ID can be found when logged into YNAB in your URL bar, and for the token you will need to create a YNAB API token. IMAP information is for the OTP flow, **and you will need to make sure email is enabled for your OTP options on your AMEX account**.

You can put this in a `.env` file or supply as environment variables normally.

`LOCAL=true` This is what determines if you are running a headless browser or not. Be careful running headless, it's glitchier, and American Express may think you're nefarious (when you just want your stinkin' transactions!)

```
API_TOKEN=ynabapitokenhere
BUDGET_ID=123123-0b123-12a1-1a23-123b1a234a
LOCAL=true
AMEX_USER=AmexUsername
AMEX_PASS=am3xP4ssw0rd!
IMAP_USERNAME=username@domain.com
IMAP_PASSWORD=em@ilP4ssw0rd123!
IMAP_INCOMING_HOST=imap.domain.com
IMAP_INCOMING_PORT=993
IMAP_TLS=true
```

### One more note...

Please be responsible, and don't try to run this every 5 minutes. I get that it's fun, but the last thing you want is an IP ban from American Express. Just run this once a day, like Plaid would if it would ever work. Hopefully OAuth rolls out soon.

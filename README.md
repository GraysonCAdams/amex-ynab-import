# AMEX YNAB Import

Unreliable connections over the course of the last few years means taking matters into our own hands. Other tools I found are still a bit of a manual process, downloading CSV's or QFX files and converting them to then upload them. This tool is meant to go the whole nine yards, and do every step for you with just one command.

When you run this script, it:

1. Logs into YNAB (API) and fetches your accounts and last reconciled dates
2. Logs into American Express (Puppeteer) and performs the One-Time Password process automatically (uses IMAP)
3. Fetches CSV data from American Express
4. Converts it into zero duplicate, YNAB format and imports through YNAB API

Being zero input and stateless, this script requires your YNAB AMEX accounts to be named the same as on American Express. It will tell you what it was unable to map so you can make the adjustments... or, fork your own version of this and allow for user input.

## Required Environment Variables

You must supply the variables below. The budget ID can be found when logged into YNAB in your URL bar, and for the token you will need to create a YNAB API token. IMAP information is for the OTP flow, **and you will need to make sure email is enabled for your OTP options on your AMEX account**.

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

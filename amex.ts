import { load } from "cheerio";
import puppeteer from "puppeteer-extra";
import { Email, EmailScanner } from "./email.js";
import { timeout } from "./utils.js";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import "dotenv/config";
import vm from "vm";
import _ from "lodash";
import axios from "axios";
import { HTTPResponse } from "puppeteer";
import { Readable } from "stream";
// @ts-ignore
import Xvfb from "xvfb";

export interface AMEXCSVTransaction {
  Date: string;
  Receipt: string;
  Description: string;
  Amount: string;
  "Extended Details": string;
  "Appears On Your Statement As": string;
  Address: string;
  Country: string;
  Reference: string;
  Category: string;
}

interface Account {
  name?: string;
  key?: string;
  token?: string;
  transactions?: Readable;
  pendingTransactions?: PendingTransaction[];
}

const fetchPendingTransactions = async (
  cookiesString: string,
  account: Account
): Promise<PendingTransaction[]> => {
  console.log(`[..] Fetching ${account.name} pending transactions`);
  const headers = {
    cookie: cookiesString,
    account_token: account.token,
    authority: "global.americanexpress.com",
    accept: "application/json",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "content-type": "application/json",
    correlation_id: "MYCA-7f1741cc-f636-4868-8c5b-012f09c5d7dd",
    pragma: "no-cache",
    referer: `https://global.americanexpress.com/activity/recent?account_key=${account.key}`,
    "sec-ch-ua":
      '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  };
  const data = (await axios.get(
    `https://global.americanexpress.com/api/servicing/v1/financials/transactions?limit=1000&status=pending&extended_details=merchant,category,tags,rewards,offer,deferred_details,receipts,flags,plan_details,transaction_codes`,
    { headers }
  )) as any;
  const pendingTransactions = data.data.transactions;
  console.log(
    `[✓] Fetched ${pendingTransactions.length} ${account.name} pending transactions`
  );
  return pendingTransactions;
};

const downloadCSV = async (
  headers: Record<string, string>,
  cookiesString: string,
  account: Account
): Promise<Readable> => {
  delete headers["vary"]; // sometimes character issues, not needed
  delete headers["set-cookie"]; // sometimes character issues, not needed

  console.log(`[..] Fetching ${account.name} CSV`);
  const startDate = new Date(new Date().getTime() - 86400 * 1000 * 10)
    .toISOString()
    .split("T")[0];
  const endDate = new Date().toISOString().split("T")[0];
  const csv = await axios.get(
    `https://global.americanexpress.com/api/servicing/v1/financials/documents?file_format=csv&start_date=${startDate}&end_date=${endDate}&limit=30&status=posted&account_key=${account.key}&client_id=AmexAPI`,
    { headers: { ...headers, Cookie: cookiesString } }
  );
  console.log(`[✓] Fetched ${account.name} CSV`);
  return Readable.from([csv.data]);
};

const getAccounts = (html: string): Account[] => {
  const $ = load(html);
  const initialStateScript = $(`script[id="initial-state"]`).html();

  if (!initialStateScript)
    throw new Error("Account information could not be found");

  interface Sandbox {
    window: {
      __INITIAL_STATE__?: string;
    };
  }
  const sandbox: Sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(initialStateScript, sandbox);
  if (!sandbox.window.__INITIAL_STATE__)
    throw new Error("Account information could not be found");

  const initialStateJSON: any = JSON.parse(sandbox.window.__INITIAL_STATE__);
  const flattenedState = initialStateJSON.flat(Infinity);
  const accountsList: Account[] = [];

  let newProduct: Account | undefined;
  const productsList = flattenedState.slice(
    flattenedState.indexOf("productsList") + 1
  );

  for (const [i, element] of productsList.entries()) {
    if (element === "product") {
      newProduct = {};
    } else if (newProduct) {
      // If there's a product being built
      const value = productsList[i + 1];
      switch (element) {
        case "description":
          newProduct.name = value
            .replace("Card", "")
            .replace("American Express", "")
            .replace("®", "")
            .trim();
          break;
        case "account_key":
          newProduct.key = value;
          break;
        case "account_token":
          newProduct.token = value;
          break;
      }
      if (newProduct.key && newProduct.name && newProduct.token) {
        accountsList.push(newProduct);
        newProduct = undefined;
      }
    }
  }

  const accounts = _.uniqBy(accountsList, "key");
  console.log(
    `Found accounts: ${accounts.map((account) => account.name).join(", ")}`
  );
  return accounts;
};

export async function fetchTransactions(): Promise<Account[]> {
  let accounts: Account[] = [];

  const virtualDisplay = process.env.LOCAL !== "true";

  const username = process.env.AMEX_USER;
  const password = process.env.AMEX_PASS;
  if (!username || !password)
    throw new Error("You must provide Amex user and password to fetch data.");

  puppeteer.use(StealthPlugin());
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--start-fullscreen",
  ];

  let xvfb;
  if (virtualDisplay) {
    xvfb = new Xvfb({
      silent: true,
      xvfb_args: ["-screen", "0", "1280x720x24", "-ac"],
    });

    xvfb.start((err: Error) => {
      if (err) console.error(err);
    });
  }

  const browser = await puppeteer.launch({
    headless: false, // for SS bug: https://developer.chrome.com/articles/new-headless/
    defaultViewport: null, //otherwise it defaults to 800x600
    args,
  });

  const page = await browser.newPage();
  page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0"
  );

  console.log("Pulling up American Express...");
  await page.goto(
    "https://www.americanexpress.com/en-us/account/login/?inav=iNavLnkLog"
  );

  console.log("Filling login credentials...");
  await page.type("#eliloUserID", username);
  await page.type("#eliloPassword", password);

  console.log("Submitting...");
  await page.click("#loginSubmit");

  console.log("Waiting for prompt to choose other OTP option...");

  try {
    await page.waitForSelector("#changeMethod", { timeout: 10000 });
    console.log("Opting out of mobile push notification...");
    await page.click("#changeMethod");
  } catch (e) {
    console.error(e);
    console.log("There was no change option, continuing...");
  }

  console.log("Searching/waiting for OTP prompt... (will choose email)");
  const authDivSelector =
    'div[class^="one-identity-authentication__styles__authContainer___"]';
  await page.waitForSelector(authDivSelector);

  let html = await page.content();
  let $ = load(html);

  let emailAuthBtnIndex: number | undefined;
  const otpButtonsDOM = $(authDivSelector)
    .find('button[data-testid="option-button"]')
    .toArray();
  for (const [i, button] of otpButtonsDOM.entries()) {
    const html = $(button).html();
    if (html && html.includes("One-time password (email)")) {
      emailAuthBtnIndex = i;
      break;
    }
  }

  if (emailAuthBtnIndex === undefined)
    throw new Error(
      "Could not find email choice for OTP option. Is it enabled on your account?"
    );

  const mailbox = new EmailScanner();
  await mailbox.connect();

  console.log('Clicking the "Email" OTP button...');
  const otpButtons = await page.$$(`${authDivSelector} button`);
  await otpButtons[emailAuthBtnIndex].click();

  const waitForEmail = mailbox.waitForEmail(
    (email: Email) =>
      email.subject === "Your American Express one-time verification code"
  );

  const email = await Promise.race([timeout(60000, false), waitForEmail]);
  if (!email) throw new Error("OTP email was not received within 60 seconds");
  mailbox.disconnect();

  let code: string | undefined;
  $ = load(email.body);
  const text = $("body").text();
  const textSplit = text.split("One-Time Verification Code:", 2);
  if (textSplit.length == 2) {
    const codeString = textSplit[1];
    const codeMatches = codeString.match(/[0-9]+/g) || [];
    const potentialCode = codeMatches[0];
    if (potentialCode && potentialCode.length === 6) code = potentialCode;
  }

  if (!code) throw new Error("OTP code could not be extracted from email");

  await page.type("#question-value", code);
  await page.click('button[data-testid="continue-button"]');

  try {
    const buttonGroupSelector =
      ".one-identity-two-step-verification__style__buttonGroup___Lt-DI";
    await page.waitForSelector(buttonGroupSelector);
    await page.click(`${buttonGroupSelector} button`);
    await page.setJavaScriptEnabled(false);
  } catch (e) {
    console.error(e);
    await page.setJavaScriptEnabled(false);
    await page.reload();
  }

  let headers = {};
  const responseHandler = (response: HTTPResponse) => {
    headers = response.headers();
    page.off("response", responseHandler);
  };
  page.on("response", responseHandler);

  await page.waitForNavigation({ waitUntil: "domcontentloaded" });

  html = await page.content();
  accounts = getAccounts(html);

  const client = await page.target().createCDPSession();
  const cookiesString = (await client.send("Network.getAllCookies")).cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  await browser.close();

  for (const account of accounts) {
    account.transactions = await downloadCSV(headers, cookiesString, account);
    account.pendingTransactions = await fetchPendingTransactions(
      cookiesString,
      account
    );
  }

  if (browser.connected) await browser.close();
  if (virtualDisplay && xvfb) xvfb.stop();
  return accounts;
}

export type PendingTransaction = {
  identifier: string;
  description: string;
  charge_date: string;
  supplementary_index: string;
  amount: number;
  type: string;
  reference_id: string;
  first_name: string;
  last_name: string;
  embossed_name: string;
  account_token: string;
  charge_timestamp: string;
  extended_details: {
    merchant: {
      identifier: string;
      chain_affiliated_identifier: string;
      name: string;
      address: {
        address_lines: string[];
        country_name: string;
        postal_code: string;
        city: string;
        state: string;
      };
      display_name: string;
      phone_number: string;
      merchant_url: string;
      additional_url: string;
      store_front_indicator: boolean;
      map_eligibility_indicator: boolean;
      geo_location: {
        latitude: string;
        longitude: string;
      };
    };
    additional_description_lines: string[];
    category: {
      category_name: string;
      subcategory_name: string;
      category_code: string;
      subcategory_code: string;
    };
    rewards: {
      display_indicator: string;
    };
  };
};

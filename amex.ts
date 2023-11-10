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
  transactions?: Readable;
}

const downloadCSV = async (
  headers: Record<string, string>,
  cookiesString: string,
  account: Account
): Promise<Readable> => {
  delete headers["vary"]; // sometimes character issues, not needed

  console.log(`[..] Fetching ${account.name} CSV`);
  const csv = await axios.get(
    `https://global.americanexpress.com/api/servicing/v1/financials/documents?file_format=csv&limit=30&status=posted&account_key=${account.key}&client_id=AmexAPI`,
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
      }
      if (newProduct.key && newProduct.name) {
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

  const username = process.env.AMEX_USER;
  const password = process.env.AMEX_PASS;
  if (!username || !password)
    throw new Error("You must provide Amex user and password to fetch data.");

  puppeteer.use(StealthPlugin());

  const browser = await puppeteer.launch({
    headless: process.env.LOCAL === "true" ? false : "new", // for SS bug: https://developer.chrome.com/articles/new-headless/
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    console.log("Pulling up American Express...");
    await page.goto(
      "https://www.americanexpress.com/en-us/account/login/?inav=iNavLnkLog"
    );

    console.log("Filling login credentials...");

    await page.type("#eliloUserID", username);
    await page.type("#eliloPassword", password);

    console.log("Submitting...");
    await page.click("#loginSubmit");

    await page.waitForSelector("#changeMethod");
    console.log("Opting out of mobile push notification...");
    await page.click("#changeMethod");

    console.log("Waiting for OTP prompt... (will choose email)");
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
    const buttonGroupSelector =
      ".one-identity-two-step-verification__style__buttonGroup___Lt-DI";
    await page.waitForSelector(buttonGroupSelector);
    await page.click(`${buttonGroupSelector} button`);
    await page.setJavaScriptEnabled(false);

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
      try {
        account.transactions = await downloadCSV(
          headers,
          cookiesString,
          account
        );
      } catch (e) {
        console.error(
          `Something went wrong downloading the CSV for ${account.name}: ${e}`
        );
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    if (browser.connected) await browser.close();
  }
  return accounts;
}

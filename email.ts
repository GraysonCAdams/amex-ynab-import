import "dotenv/config";
import IMAP, { Box, ImapMessage } from "node-imap";
import quotedPrintable from "quoted-printable";

export interface Email {
  subject: string;
  from: string;
  body: string;
}

type EmailTuple = [number, Email];

const INBOX_NAME = process.env.IMAP_INBOX_NAME || "INBOX";

const REQUIRED_ENV_VARS = [
  "IMAP_USERNAME",
  "IMAP_PASSWORD",
  "IMAP_INCOMING_HOST",
  "IMAP_INCOMING_PORT",
  "IMAP_TLS",
];

const ENV_VARS = Object.keys(process.env);

const missingVariables = REQUIRED_ENV_VARS.filter(
  (REQUIRED_VAR) => !ENV_VARS.includes(REQUIRED_VAR)
);

if (missingVariables.length > 0)
  throw new Error(
    `IMAP configuration missing env variables: ${missingVariables.join(", ")}`
  );

const imap = new IMAP({
  user: process.env.IMAP_USERNAME!,
  password: process.env.IMAP_PASSWORD!,
  host: process.env.IMAP_INCOMING_HOST,
  port: parseInt(process.env.IMAP_INCOMING_PORT!),
  tls: process.env.IMAP_TLS!.toLowerCase() === "true",
});

export class EmailScanner {
  connected = false;
  box: Box | undefined;

  connect = () =>
    new Promise<boolean>(async (resolve) => {
      console.log("Connecting to mail server...");
      imap.connect();

      imap.once("ready", () => {
        console.log("Successfully connected to mail server!");
        console.log("Opening mailbox...");
        imap.openBox(INBOX_NAME, true, async (err, box) => {
          if (err) throw err;
          console.log("Mailbox opened");
          this.box = box;
          this.connected = true;
          resolve(true);
        });
      });
    });

  disconnect = () => {
    this.connected = false;
    imap.end();
  };

  static readEmail = (imapMsg: ImapMessage) =>
    new Promise<Email>((resolve, reject) => {
      let headers: { [index: string]: string[] } | undefined;
      let body: string | undefined;
      imapMsg.on("body", (stream, info) => {
        let buffer = "";
        let count = 0;
        stream.on("data", function (chunk) {
          count += chunk.length;
          buffer += chunk.toString("utf8");
        });
        stream.once("end", function () {
          switch (info.which) {
            case "HEADER.FIELDS (FROM SUBJECT)":
              headers = IMAP.parseHeader(buffer);
              break;
            case "TEXT":
              body = quotedPrintable.decode(buffer.toString());
              break;
          }
        });
      });
      imapMsg.once("end", function (attrs) {
        if (headers && body) {
          resolve({
            from: headers.from[0],
            subject: headers.subject[0],
            body,
          });
        }
      });
    });

  fetchEmails = async (
    startIndex: number,
    endIndex: number
  ): Promise<EmailTuple[]> =>
    new Promise((resolve, reject) => {
      const emails: EmailTuple[] = [];
      const fetch = imap.seq.fetch(`${startIndex}:${endIndex}`, {
        bodies: ["HEADER.FIELDS (FROM SUBJECT)", "TEXT"],
        struct: true,
      });
      fetch.on("message", async (imapMsg, seqno) => {
        const email = await EmailScanner.readEmail(imapMsg);
        emails.push([seqno, email]);
      });
      fetch.once("end", function () {
        resolve(emails);
      });
      fetch.once("error", function (err) {
        reject(err);
      });
    });

  deleteEmail = async (seqno: number) =>
    new Promise<void>((resolve, reject) => {
      imap.seq.setFlags(seqno, "\\Deleted", (err) => {
        if (err) reject(err);
        else
          imap.expunge((err) => {
            if (err) reject(err);
            resolve();
          });
      });
    });

  waitForEmail = async (match: Function) =>
    new Promise<Email>((resolve, reject) => {
      if (!this.connected || !this.box)
        throw new Error("Not connected to mail account");

      console.log("Watching for new emails...");

      imap.on("mail", async (newEmailCount) => {
        console.log(`${newEmailCount} new email(s), scanning contents...`);
        const endIndex = this.box!.messages.total;
        const startIndex = endIndex - (newEmailCount - 1);
        try {
          const emails = await this.fetchEmails(startIndex, endIndex);
          for (const [seqno, email] of emails) {
            if (match(email)) {
              console.log("Found the OTP email");
              try {
                await this.deleteEmail(seqno);
                console.log("Discarded email now that it's cached");
              } catch (e) {
                console.error(
                  `Cannot delete OTP email. Sorry for the spam! ${e}`
                );
              }
              imap.end();
              resolve(email);
              return;
            }
          }
        } catch (e) {
          console.error(e);
        }
      });
    });
}

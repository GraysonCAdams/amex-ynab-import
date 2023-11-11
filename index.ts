import "dotenv/config";
import { fetchTransactions } from "./amex.js";
import { convertCSV, createTransactions, fetchAccounts } from "./ynab.js";
import axios from "axios";

(async () => {
  try {
    const ynabAccounts = await fetchAccounts();

    console.log(
      "Going to American Express to fetch your CSV files and match to YNAB accounts by name"
    );

    const amexAccounts = await fetchTransactions();
    if (amexAccounts.length == 0) throw new Error("Something has gone awry.");

    for (const amexAccount of amexAccounts) {
      const ynabAccount = ynabAccounts.find(
        (ynabAccount) => ynabAccount.name === amexAccount.name
      );

      if (!ynabAccount) {
        console.warn(
          `There is no YNAB account named "${amexAccount.name}". Rename appropriate YNAB account to link.`
        );
        continue;
      }

      if (!amexAccount.transactions) {
        console.warn(
          `There are no transactions found for Amex account ${amexAccount.name}`
        );
        continue;
      }

      ynabAccount.pendingTransactions = await convertCSV(
        amexAccount.transactions,
        ynabAccount.id
      );

      if (ynabAccount.last_reconciled_at)
        ynabAccount.pendingTransactions =
          ynabAccount.pendingTransactions.filter(
            (t) => new Date(t.date!) >= ynabAccount.last_reconciled_at!
          );
    }

    const readyAccounts = ynabAccounts.filter(
      (ynabAccount) => ynabAccount.pendingTransactions
    );

    readyAccounts.forEach((ynabAccount) => {
      console.log(`${ynabAccount.name} may have some transactions imported`);
    });

    const transactions = readyAccounts
      .map((ynabAccount) => ynabAccount.pendingTransactions)
      .flat();

    console.log(
      `Importing ${transactions.length} transactions to YNAB (it will ignore duplicate imports, so actual amount may differ)`
    );

    // @ts-ignore
    await createTransactions(transactions);

    console.log("All done. Until next time! 👋");
    process.exit(0);
  } catch (e) {
    if (process.env.WEBHOOK_URL && process.env.LOCAL !== "true") {
      try {
        await axios.post(process.env.WEBHOOK_URL, {
          message: "There was an issue syncing transactions.",
          title: "AMEX YNAB Import",
        });
      } catch (e) {
        console.error("Failed to send webhook.");
      }
    }
    console.error(e);
    process.exit(1);
  }
})();

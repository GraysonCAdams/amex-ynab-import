import "dotenv/config";
import * as amex from "./amex.js";
import {
  convertCSV,
  convertPendingTransactions,
  fetchTransactions,
  createTransactions,
  fetchAccounts,
  deleteTransaction,
} from "./ynab.js";
import axios from "axios";
import fs from "fs";

(async () => {
  try {
    const ynabAccounts = await fetchAccounts();
    const ynabTransactions = await fetchTransactions();

    console.log(
      "Going to American Express to fetch your CSV files and match to YNAB accounts by name"
    );

    const amexAccounts = await amex.fetchTransactions();
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

      const csvTransactions = amexAccount.transactions
        ? await convertCSV(amexAccount.transactions, ynabAccount.id)
        : [];

      const pendingTransactions = amexAccount.pendingTransactions
        ? await convertPendingTransactions(
            amexAccount.pendingTransactions,
            ynabAccount.id
          )
        : [];

      ynabAccount.queuedTransactions = [
        ...csvTransactions,
        ...pendingTransactions,
      ];
    }

    const readyAccounts = ynabAccounts.filter(
      (ynabAccount) => ynabAccount.queuedTransactions.length > 0
    );

    readyAccounts.forEach((ynabAccount) => {
      console.log(`${ynabAccount.name} may have some transactions imported`);
    });

    /*
     * TODO: Collect YNAB pending transactions (labeled)... compare against
     * current pending transactions, remove the ones that don't match from YNAB,
     * add the ones that are not in YNAB
     */

    const newTransactions = readyAccounts
      .map((ynabAccount) => ynabAccount.queuedTransactions)
      .flat();

    const notLongerPendingTransactions = ynabTransactions.filter(
      (oldTransaction) =>
        oldTransaction.flag_color === "blue" &&
        !newTransactions.find(
          (newTransaction) =>
            newTransaction.import_id === oldTransaction.import_id &&
            newTransaction.flag_color === "blue"
        )
    );

    for (const transaction of notLongerPendingTransactions) {
      console.log(
        `Deleting transaction ${transaction.id} / ${transaction.import_id} from ${transaction.account_name}`
      );
      await deleteTransaction(transaction.id);
    }

    console.log(
      `Importing ${newTransactions.length} transactions to YNAB (it will ignore duplicate imports, so actual amount may differ)`
    );

    // @ts-ignore
    await createTransactions(newTransactions);

    console.log("All done. Until next time! 👋");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

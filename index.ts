import "dotenv/config";
import * as amex from "./amex.js";
import {
  convertCSV,
  convertPendingTransactions,
  fetchTransactions,
  createTransactions,
  fetchAccounts,
  deleteTransaction,
  ynabAPI,
  budgetId,
} from "./ynab.js";
import axios from "axios";
import fs from "fs";
import { TransactionDetail } from "ynab";

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

    const formatTransaction = (t: TransactionDetail) =>
      `${t.account_name}: $${t.amount / 1000} at ${t.payee_name} on ${t.date}`;

    let newTransactions = readyAccounts
      .map((ynabAccount) => ynabAccount.queuedTransactions)
      .flat();

    const deleteTransactions = [];

    for (const transaction of ynabTransactions.filter(
      (t) => t.flag_color === "blue" && !t.deleted
      // t.import_id
    )) {
      const matchedTransaction = newTransactions.find(
        (newTransaction) =>
          newTransaction.date === transaction.date &&
          newTransaction.amount === transaction.amount &&
          newTransaction.account_id === transaction.account_id
      );

      if (matchedTransaction && matchedTransaction?.flag_color === "blue") {
        console.log(
          `Transaction ${formatTransaction(transaction)} still pending`
        );
      } else if (
        matchedTransaction &&
        matchedTransaction.flag_color !== "blue"
      ) {
        newTransactions = newTransactions.filter(
          (t) => t !== matchedTransaction
        );
        console.log(
          `Transaction ${formatTransaction(transaction)} posted, updating...`
        );
        await ynabAPI.transactions.updateTransaction(
          budgetId!,
          transaction.id,
          {
            transaction: {
              flag_color: null,
              cleared: "cleared",
              approved: false,
            },
          }
        );
      } else if (!matchedTransaction) {
        deleteTransactions.push(transaction);
        continue;
      } else {
        console.log(
          `Could not find an existing match for ${formatTransaction(
            transaction
          )}`
        );
      }
    }

    for (const transaction of deleteTransactions) {
      console.log(
        `Deleting stale pending transaction ${formatTransaction(transaction)}`
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

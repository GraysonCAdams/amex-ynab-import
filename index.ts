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
import { SaveTransaction, TransactionDetail } from "ynab";

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

    let transactionsToImport = readyAccounts
      .map((ynabAccount) => ynabAccount.queuedTransactions)
      .flat();

    let deleteTransactions: TransactionDetail[] = [];

    for (const existingPendingTransaction of ynabTransactions.filter(
      (t) => t.flag_color === "blue" && !t.deleted
      // t.import_id
    )) {
      const matchedImportTransactions = transactionsToImport.filter(
        (importTransaction) =>
          Math.abs(
            new Date(importTransaction.date as string).getTime() -
              new Date(existingPendingTransaction.date as string).getTime()
          ) <=
            86400 * 2 * 1000 &&
          importTransaction.amount === existingPendingTransaction.amount &&
          importTransaction.account_id === existingPendingTransaction.account_id
      );

      if (matchedImportTransactions.length === 0) {
        deleteTransactions.push(existingPendingTransaction);
        continue;
      }

      // We only care about the first one
      const matchedImportTransaction = matchedImportTransactions[0];

      // Remove the rest
      const beforeSize = transactionsToImport.length;
      transactionsToImport = transactionsToImport.filter(
        (t) => !matchedImportTransactions.slice(1).includes(t)
      );
      const afterSize = transactionsToImport.length;

      if (beforeSize > afterSize)
        console.log(
          `Skipping ${
            beforeSize - afterSize
          } other duplicate transactions for ${formatTransaction(
            existingPendingTransaction
          )}`
        );

      if (matchedImportTransaction.flag_color === "blue") {
        console.log(
          `Transaction ${formatTransaction(
            existingPendingTransaction
          )} still pending`
        );
      } else {
        transactionsToImport = transactionsToImport.filter(
          (t) => t !== matchedImportTransaction
        );
        console.log(
          `Transaction ${formatTransaction(
            existingPendingTransaction
          )} posted, updating...`
        );
        await ynabAPI.transactions.updateTransaction(
          budgetId!,
          existingPendingTransaction.id,
          {
            transaction: {
              flag_color: null,
              cleared: "cleared",
              approved: false,
            },
          }
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
      `Importing ${transactionsToImport.length} transactions to YNAB (it will ignore duplicate imports, so actual amount may differ)`
    );

    // @ts-ignore
    await createTransactions(transactionsToImport);

    console.log("All done. Until next time! 👋");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

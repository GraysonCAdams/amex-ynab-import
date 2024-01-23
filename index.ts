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

    const formatTransaction = (t: TransactionDetail) =>
      `${t.account_name}: $${t.amount / 1000} at ${t.payee_name} on ${t.date}`;

    const importTransactions = readyAccounts
      .map((ynabAccount) => ynabAccount.queuedTransactions)
      .flat();

    const staleTransactions: TransactionDetail[] = [];
    const pendingTransactionsThatPosted: TransactionDetail[] = [];

    const pendingExistingTransactions = ynabTransactions.filter(
      (t) =>
        t.cleared === "uncleared" &&
        !t.deleted &&
        readyAccounts.find((account) => account.name === t.account_name)
    );

    for (const existingPendingTransaction of pendingExistingTransactions) {
      const matchedImportTransaction = importTransactions.find(
        (t) =>
          t.amount === existingPendingTransaction.amount &&
          (!existingPendingTransaction.import_payee_name ||
            t.payee_name?.trim() ===
              existingPendingTransaction.import_payee_name.trim()) &&
          Math.abs(
            new Date(t.date as string).getTime() -
              new Date(existingPendingTransaction.date as string).getTime()
          ) <=
            86400 * 3 * 1000
      );
      if (
        matchedImportTransaction &&
        matchedImportTransaction.cleared === "uncleared"
      ) {
        console.log(
          `Transaction ${formatTransaction(
            existingPendingTransaction
          )} still pending`
        );
        continue;
      } else if (matchedImportTransaction) {
        console.log(
          `Transaction ${formatTransaction(
            existingPendingTransaction
          )} posted. Copying over data to new transaction entry.`
        );
        matchedImportTransaction.memo = existingPendingTransaction.memo;
        matchedImportTransaction.payee_name =
          existingPendingTransaction.payee_name;
        matchedImportTransaction.approved = existingPendingTransaction.approved;
        matchedImportTransaction.category_id =
          existingPendingTransaction.category_id;
        pendingTransactionsThatPosted.push(existingPendingTransaction);
      } else {
        staleTransactions.push(existingPendingTransaction);
      }
    }

    for (const transaction of staleTransactions) {
      console.log(
        `Clearing out stale transaction ${formatTransaction(transaction)}`
      );
      await deleteTransaction(transaction.id);
    }

    for (const transaction of pendingTransactionsThatPosted) {
      console.log(
        `Clearing out pending transaction that posted: ${formatTransaction(
          transaction
        )}`
      );
      await deleteTransaction(transaction.id);
    }

    console.log(
      `Importing ${importTransactions.length} transactions to YNAB (it will ignore duplicate imports, so actual amount may differ)`
    );

    // @ts-ignore
    await createTransactions(importTransactions);

    console.log("All done. Until next time! 👋");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();

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
import stringSimilarity from "string-similarity";
import { match } from "assert";

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

    const formatTransaction = (t: TransactionDetail | SaveTransaction) =>
      `${t.account_id}: $${t.amount! / 1000} at ${t.payee_name} on ${t.date}`;

    const unfilteredImportTransactions = readyAccounts
      .map((ynabAccount) => ynabAccount.queuedTransactions)
      .flat();

    let importTransactions: SaveTransaction[] =
      unfilteredImportTransactions.reduce(
        (transactions, parentTransaction) => {
          const voidingTransaction = transactions.find(
            (t) =>
              t.cleared === "uncleared" &&
              t.amount === -parentTransaction.amount! &&
              t.payee_name === parentTransaction.payee_name &&
              t.date === parentTransaction.date
          );
          if (voidingTransaction) {
            console.log(
              `Transaction ${formatTransaction(
                parentTransaction
              )} has a voiding transaction, ignoring...`
            );
            transactions = transactions.filter(
              (t) => t !== voidingTransaction && t !== parentTransaction
            );
          }
          return transactions;
        },
        [...unfilteredImportTransactions]
      );

    const staleTransactions: TransactionDetail[] = [];
    const pendingTransactionsThatPosted: TransactionDetail[] = [];

    const pendingExistingTransactions = ynabTransactions.filter(
      (t) =>
        t.cleared === "uncleared" &&
        !t.deleted &&
        readyAccounts.find((account) => account.name === t.account_name)
    );

    for (const existingPendingTransaction of pendingExistingTransactions) {
      const matchedImportTransaction = importTransactions.find((t) => {
        const dateMatch =
          Math.abs(
            new Date(t.date as string).getTime() -
              new Date(existingPendingTransaction.date as string).getTime()
          ) <=
          86400 * 3 * 1000;

        const amountMatch = t.amount === existingPendingTransaction.amount;

        const cleanImportName = (payeeName: string) =>
          payeeName.replace("Aplpay ", "").replace("Tst* ", "");

        const importPayeeName = cleanImportName(t.payee_name!.trim());
        const existingPayeeName = cleanImportName(
          (
            existingPendingTransaction.import_payee_name! ||
            existingPendingTransaction.payee_name!
          ).trim()
        );

        const payeeMatch =
          importPayeeName === existingPayeeName ||
          stringSimilarity.compareTwoStrings(
            importPayeeName,
            existingPayeeName
          ) >= 0.25;

        return dateMatch && amountMatch && payeeMatch;
      });
      if (
        matchedImportTransaction &&
        matchedImportTransaction.cleared === "uncleared"
      ) {
        console.log(
          `Transaction ${formatTransaction(
            existingPendingTransaction
          )} still pending`
        );

        if (
          existingPendingTransaction.date !== matchedImportTransaction.date ||
          existingPendingTransaction.import_id !==
            matchedImportTransaction.import_id
        ) {
          console.log(
            `Pending transaction ${formatTransaction(
              existingPendingTransaction
            )} has changed date or import ID. Ignoring to prevent duplicate...`
          );
          importTransactions = importTransactions.filter(
            (t) => t !== matchedImportTransaction
          );
        }
        continue;
      } else if (matchedImportTransaction) {
        const bannedPayeeNameStarts = [
          "Transfer : ",
          "Starting Balance",
          "Manual Balance Adjustment",
          "Reconciliation Balance Adjustment",
        ];

        if (
          !bannedPayeeNameStarts.some((payeeNameStart) =>
            matchedImportTransaction.payee_name?.startsWith(payeeNameStart)
          )
        )
          matchedImportTransaction.payee_name =
            existingPendingTransaction.payee_name;

        matchedImportTransaction.approved = existingPendingTransaction.approved;
        matchedImportTransaction.category_id =
          existingPendingTransaction.category_id;
        matchedImportTransaction.memo = existingPendingTransaction.memo;
        matchedImportTransaction.subtransactions =
          existingPendingTransaction.subtransactions;

        console.log(
          `Transaction ${formatTransaction(
            existingPendingTransaction
          )} posted. Copying over data to new transaction entry.`,
          matchedImportTransaction
        );
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

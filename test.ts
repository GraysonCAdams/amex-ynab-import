let newTransactions = [{ a: "b" }];
let ynabTransactions = [{ a: "b" }];

for (const transaction of ynabTransactions) {
  const matchedTransaction = newTransactions.find(
    (newTransaction) => newTransaction.a == "b"
  );

  if (matchedTransaction) {
    newTransactions = newTransactions.filter((t) => t !== matchedTransaction);
    console.log(`Transaction posted, updating...`);
  }
}

console.log(newTransactions);

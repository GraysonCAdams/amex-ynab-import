export const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const timeout = (ms: number, fail: boolean) =>
  new Promise<void>((resolve, reject) => {
    setTimeout(() => {
      if (fail) reject(new Error("Timeout reached"));
      else resolve();
    }, ms);
  });

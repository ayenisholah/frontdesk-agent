export class PollTimeout extends Error {
  constructor() {
    super("Polling timed out");
  }
}
export async function poll(
  check: () => Promise<boolean>,
  wait: () => Promise<void>,
  attempts: number,
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    if (attempt + 1 < attempts) await wait();
  }
  throw new PollTimeout();
}

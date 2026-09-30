export type SignalInsertFailure = {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
};

export class SignalInsertError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly signalsSavedBeforeFailure: number,
    readonly failedBatchSize: number,
    readonly details?: string | null,
  ) {
    super(message);
    this.name = "SignalInsertError";
  }
}

export async function insertSignalBatch<T>(
  rows: T[],
  persist: (batch: T[]) => Promise<{ data: number | null; error: SignalInsertFailure | null }>,
  signalsSavedBeforeFailure = 0,
): Promise<number> {
  if (rows.length === 0 || rows.length > 100) throw new Error("Signal insert batch must contain between 1 and 100 rows.");
  const result = await persist(rows);
  if (result.error) {
    throw new SignalInsertError(
      result.error.message,
      result.error.code ?? "unknown",
      signalsSavedBeforeFailure,
      rows.length,
      result.error.details,
    );
  }
  return result.data ?? 0;
}

(globalThis as unknown as { step: unknown }).step = async (
  name: string,
  fn: () => void | Promise<void>,
): Promise<void> => {
  try {
    await fn();
  } catch (err) {
    if (err instanceof Error) err.message = `step "${name}": ${err.message}`;
    throw err;
  }
};

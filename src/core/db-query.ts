export function unwrapFirst<T>(result: [T[]]): T | undefined {
  return result?.[0]?.[0];
}

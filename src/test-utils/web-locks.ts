/** A serialized Web Locks test double. Callbacks run only after the previous lease ends. */
export function testWebLocks() {
  let tail = Promise.resolve();
  return {
    request<T>(_name: string, _options: unknown, callback: () => T | Promise<T>): Promise<T> {
      const result = tail.then(callback);
      tail = result.then(() => {}, () => {});
      return result;
    },
  };
}

export function installTestWebLocks() {
  Object.defineProperty(navigator, "locks", { configurable: true, value: testWebLocks() });
}

/*
This function is necessary to make sure that a default isn't generated multiple times at the same time.
Doing that will cause errors.

An example is the jwt secret value, it's value is requested around 3 times at the same time while starting.
So when the program was started for the first time, each request returned a different secret.

This function will try and see if its first function returns a value, if it does, it will return that value.
(A Failure object will be seen as a value, only null and undefined are counted as non-values)
If not it will execute a fallback function, which usually is a function that populates a default value.
After that is done it will retry the first function again.
*/

const fallBackMap: Record<string, Promise<unknown>> = {};

export async function MutexFallBack<
  MF extends () => Promise<O | null | undefined>,
  FF extends () => Promise<O>,
  O,
>(key: string, mainFunc: MF, fallBackFunc: FF): Promise<O> {
  const try_it = await mainFunc();
  if (try_it !== undefined && try_it !== null) return try_it;

  // Check if a fallback is already running, if so wait on that
  if (fallBackMap[key] !== undefined) {
    await fallBackMap[key];

    // When it is done, try again
    return MutexFallBack(key, mainFunc, fallBackFunc);
  }

  // Re-check right before starting: between the lookup above and here another
  // request may have finished and removed its entry, and starting a second
  // fallback for the same key is what hit the unique constraint (audit A-16).
  const rechecked = await mainFunc();
  if (rechecked !== undefined && rechecked !== null) return rechecked;

  // No fallback is running, start one
  const fallBackPromise = fallBackFunc();

  // Save the running fallback, and make sure it is cleared when it is done.
  // `.then(clear, clear)` instead of `.finally(...)`: the promise returned by
  // `finally` was never handled, so a rejecting fallback produced an unhandled
  // rejection (audit A-13).
  fallBackMap[key] = fallBackPromise;
  const clear = () => {
    delete fallBackMap[key];
  };
  fallBackPromise.then(clear, clear);

  return fallBackPromise;
}

/**
 * Reload the tab onto whatever the server serves right now.
 *
 * A plain `reload()` can be answered from the browser cache, which after an
 * upgrade leaves the old bundle running against the new server. The unique
 * parameter makes the document request uncacheable without changing the route.
 */
export function reloadFresh(location: Location): void {
  try {
    const url = new URL(location.href);
    url.searchParams.set('_upgraded', String(Date.now()));
    location.replace(url.toString());
    return;
  } catch {
    // Anything unexpected: fall back to a plain reload.
  }

  location.reload();
}

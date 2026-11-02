// Browser-safe data helpers; network and Electron windows are injected by main.cjs.
function offerArray(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.data?.data)) return response.data.data;
  return [];
}

function offerDetail(response, fallback) {
  const data = response?.data?.data ?? response?.data ?? response;
  return data && !Array.isArray(data) ? { ...fallback, ...data } : fallback;
}

async function collectOffers({ fetchPage, fetchDomPage, limit = 50, pause = async () => {} }) {
  const offers = new Map();
  const add = rows => {
    const before = offers.size;
    for (const row of rows) {
      const key = String(row?.id ?? row?.url ?? '');
      if (key && row?.url && !offers.has(key)) offers.set(key, row);
      if (offers.size >= limit) break;
    }
    return offers.size - before;
  };
  for (let offset = 0; offset < 120 && offers.size < limit; offset += 40) {
    const rows = offerArray(await fetchPage(offset, 40));
    if (!add(rows)) break;
    if (offers.size < limit) await pause();
  }
  if (fetchDomPage && offers.size < limit) {
    for (let page = 1; page <= 3 && offers.size < limit; page++) {
      if (!add(await fetchDomPage(page))) break;
      if (offers.size < limit) await pause();
    }
  }
  return [...offers.values()];
}

module.exports = { offerArray, offerDetail, collectOffers };
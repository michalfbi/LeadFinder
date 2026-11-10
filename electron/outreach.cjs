const { createEmailEngine } = require("./email.cjs");
const { createInbox } = require("./inbox.cjs");

/**
 * Spina silnik e-mail ze skrzynką odpowiedzi. Jedno miejsce dla aplikacji
 * (main.cjs) i dla symulacji (simulation.cjs), żeby test sprawdzał to samo
 * połączenie, które działa u właściciela.
 *
 * deps:
 *  email      → zależności silnika e-mail (file, read, write, db, sleep, encrypt, decrypt, ...)
 *  inboxDb()  → połączenie SQLite z tabelami messages i costs albo null
 *  read(name, fallback) / write(name, value) → pliki ustawień skrzynki
 *  encrypt / decrypt, fetchImpl, now
 *  blockPhone(address)            → dopisuje numer do listy blokad SMS
 *  isBlocked({ channel, address }) → boolean
 *  sendSms(address, body)          → Promise
 *  notify(message)                 → powiadomienie właściciela
 */
function createOutreach(d) {
  let inbox = null;
  const emailEngine = createEmailEngine({
    ...d.email,
    onReply: (r) =>
      inbox?.ingest({
        channel: "email",
        lead: r.lead,
        address: r.from,
        text: r.text,
        at: r.at,
        externalId: r.uid,
        outbound: r.lead.email_exact_text || r.lead.email_prepared_body,
      }),
  });
  inbox = createInbox({
    db: d.inboxDb,
    read: d.read,
    write: d.write,
    encrypt: d.encrypt,
    decrypt: d.decrypt,
    fetchImpl: d.fetchImpl,
    now: d.now,
    block: ({ channel, address }) => {
      if (channel === "email") emailEngine.blacklist(address);
      else d.blockPhone(address);
    },
    isBlocked: d.isBlocked,
    send: ({ channel, leadId, address, body }) =>
      channel === "email"
        ? emailEngine.reply(leadId, body)
        : d.sendSms(address, body),
    notify: d.notify,
  });
  return { emailEngine, inbox };
}

module.exports = { createOutreach };

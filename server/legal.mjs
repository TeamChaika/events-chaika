import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { AppError, token } from "./store.mjs";

const definitions = [
  ["privacy", "privacy-policy", "Политика обработки данных", ""],
  [
    "terms",
    "terms",
    "Условия покупки и возврата",
    "Принимаю условия покупки и возврата билетов.",
  ],
  [
    "consent",
    "consent",
    "Согласие на обработку данных",
    "Даю согласие на обработку персональных данных на условиях отдельного согласия.",
  ],
  ["cookies", "cookies", "Использование cookies", ""],
  [
    "marketing",
    "marketing-consent",
    "Согласие на рекламные СМС",
    "Хочу получать по СМС новости о мероприятиях и специальные предложения «Гастро Двора» от ООО «БРИЗ».",
  ],
];

// Publishing requires completed texts and a new version. Never relabel a draft
// or overwrite an accepted version: old text is kept in legal_documents.
export const currentLegalDocuments = definitions.map(
  ([slug, file, title, acceptance_label]) => ({
    slug,
    version: "2026-09-26.1",
    status: "published",
    title,
    acceptance_label,
    content: readFileSync(
      new URL(`../docs/legal/${file}.md`, import.meta.url),
      "utf8",
    ),
  }),
);

export async function legalService(
  store,
  { demo, documents = currentLegalDocuments },
) {
  const preview = demo && process.env.NODE_ENV !== "production";
  const catalog = documents.map((doc) => ({
    ...doc,
    hash: createHash("sha256")
      .update(
        JSON.stringify([
          doc.slug,
          doc.version,
          doc.status,
          doc.title,
          doc.acceptance_label,
          doc.content,
        ]),
      )
      .digest("hex"),
  }));
  if (
    catalog.length !== definitions.length ||
    definitions.some(
      ([slug]) => catalog.filter((doc) => doc.slug === slug).length !== 1,
    )
  )
    throw new Error(
      "Legal catalog must contain exactly one version of each document",
    );
  for (const doc of catalog) {
    if (
      !["draft", "published"].includes(doc.status) ||
      !/^[a-zA-Z0-9._-]{1,80}$/.test(doc.version) ||
      !doc.content.trim()
    )
      throw new Error("Invalid legal document");
    if (
      doc.status === "published" &&
      /ЧЕРНОВИК|\[(?:УТОЧНИТЬ|УТВЕРДИТЬ|ДОПОЛНИТЬ|ОПРЕДЕЛИТЬ|ДО ПУБЛИКАЦИИ|ЮРИДИЧЕСКОЕ)/i.test(
        doc.content,
      )
    )
      throw new Error("Cannot publish incomplete legal documents");
  }
  await store.transaction(async () => {
    for (const doc of catalog) {
      const existing = await store.get(
        "SELECT hash FROM legal_documents WHERE slug=? AND version=?",
        doc.slug,
        doc.version,
      );
      if (existing && existing.hash !== doc.hash)
        throw new Error(
          `Legal document ${doc.slug} changed without a new version`,
        );
      await store.run(
        "INSERT OR IGNORE INTO legal_documents(hash,slug,version,status,title,acceptance_label,content) VALUES (?,?,?,?,?,?,?)",
        doc.hash,
        doc.slug,
        doc.version,
        doc.status,
        doc.title,
        doc.acceptance_label,
        doc.content,
      );
    }
  });
  const checkoutReady =
    preview ||
    catalog
      .filter((doc) => doc.slug !== "marketing")
      .every((doc) => doc.status === "published");
  const marketingDocument = catalog.find((doc) => doc.slug === "marketing");
  const marketingReady = preview || marketingDocument.status === "published";
  const visible = catalog.filter(
    (doc) => preview || doc.status === "published",
  );
  return {
    checkoutReady,
    summary: () => ({
      preview,
      checkout_ready: checkoutReady,
      marketing_ready: marketingReady,
      documents: visible.map(({ content, ...doc }) => doc),
    }),
    document: async (slug, hash) => {
      if (
        !definitions.some(([id]) => id === slug) ||
        (hash && !/^[a-f0-9]{64}$/.test(hash))
      )
        throw new AppError(404, "Документ не найден");
      const doc = hash
        ? await store.get(
            "SELECT * FROM legal_documents WHERE slug=? AND hash=?",
            slug,
            hash,
          )
        : visible.find((doc) => doc.slug === slug);
      if (!doc || (!preview && doc.status !== "published"))
        throw new AppError(404, "Документ не найден");
      return doc;
    },
    validate: (acceptances) => {
      if (!checkoutReady)
        throw new AppError(
          409,
          "Документы для покупки ещё готовятся. Оформление временно недоступно.",
        );
      for (const slug of ["terms", "consent"]) {
        const doc = catalog.find((doc) => doc.slug === slug);
        if (acceptances?.[slug]?.accepted !== true)
          throw new AppError(
            400,
            slug === "terms"
              ? "Примите условия покупки"
              : "Необходимо отдельное согласие на обработку данных",
          );
        if (acceptances[slug].hash !== doc.hash)
          throw new AppError(
            409,
            "Документы обновились. Откройте форму заново и ознакомьтесь с новой редакцией.",
          );
      }
    },
    validateMarketing: (acceptance) => {
      if (
        acceptance?.accepted === true &&
        (!marketingReady || acceptance.hash !== marketingDocument.hash)
      )
        throw new AppError(
          409,
          "Условия рекламной подписки обновились. Откройте форму заново или снимите необязательную галочку.",
        );
    },
    // Called inside the order transaction. All records commit with the order,
    // before creating a payment; retries reuse the original acceptance time.
    record: async (order, acceptances) => {
      for (const slug of ["terms", "consent"]) {
        const doc = catalog.find((doc) => doc.slug === slug);
        await store.run(
          "INSERT INTO order_acceptances(order_id,kind,document_hash,accepted_at,buyer_session) VALUES (?,?,?,?,?)",
          order.id,
          slug,
          doc.hash,
          order.created_at,
          order.buyer_session,
        );
      }
      if (acceptances?.marketing?.accepted === true)
        await store.run(
          "INSERT INTO sms_consents(order_id,phone,document_hash,accepted_at,buyer_session,unsubscribe_token) VALUES (?,?,?,?,?,?)",
          order.id,
          "+" + order.phone.replace(/\D/g, "").replace(/^8(?=\d{10}$)/, "7"),
          marketingDocument.hash,
          order.created_at,
          order.buyer_session,
          token(),
        );
    },
  };
}

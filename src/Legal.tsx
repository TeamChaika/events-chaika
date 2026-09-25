import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, FileText } from "lucide-react";
import { api } from "./types";
import { Brand, ErrorNotice, Spinner } from "./ui";
import "./legal.css";

export type LegalDocument = {
  slug: string;
  title: string;
  hash: string;
  version: string;
  status: "draft" | "published";
  acceptance_label: string;
  content?: string;
};
export type LegalCatalog = {
  preview: boolean;
  checkout_ready: boolean;
  marketing_ready: boolean;
  documents: LegalDocument[];
};
export const legalHref = (doc: LegalDocument) =>
  `/legal/${doc.slug}?hash=${doc.hash}`;
const links = [
  ["terms", "Покупка и возврат"],
  ["privacy", "Персональные данные"],
  ["consent", "Согласие"],
  ["cookies", "Cookies"],
  ["marketing", "Рекламные СМС"],
];

export function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Документы сайта">
      {links.map(([slug, title]) => (
        <a key={slug} href={`/legal/${slug}`}>
          {title}
        </a>
      ))}
    </nav>
  );
}

const noticeKey = "chaika.cookie-notice.v1";
export function CookieNotice() {
  const [visible, setVisible] = useState(() => {
    try {
      return sessionStorage.getItem(noticeKey) !== "seen";
    } catch {
      return true;
    }
  });
  if (!visible) return null;
  return (
    <aside className="cookie-notice" aria-label="Технические cookies">
      <p>
        Используем технические cookies для оформления заказа и входа
        сотрудников. <a href="/legal/cookies">Подробнее</a>
      </p>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          setVisible(false);
          try {
            sessionStorage.setItem(noticeKey, "seen");
          } catch {
            /* Closing also works without browser storage. */
          }
        }}
      >
        Понятно
      </button>
    </aside>
  );
}

// A small, text-only renderer for our document subset. React escapes text;
// images, embedded HTML and arbitrary link protocols are not supported.
function inline(text: string): ReactNode[] {
  return text
    .split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g)
    .map((part, i) => {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const local: Record<string, string> = {
          "cookies.md": "/legal/cookies",
          "privacy-policy.md": "/legal/privacy",
          "consent.md": "/legal/consent",
          "terms.md": "/legal/terms",
          "marketing-consent.md": "/legal/marketing",
          "cookies.draft.md": "/legal/cookies",
          "privacy-policy.draft.md": "/legal/privacy",
          "consent.draft.md": "/legal/consent",
          "terms.draft.md": "/legal/terms",
          "marketing-consent.draft.md": "/legal/marketing",
        };
        const href =
          local[link[2]] ||
          (/^(https:\/\/|mailto:)/.test(link[2]) ? link[2] : "");
        return href ? (
          <a key={i} href={href}>
            {link[1]}
          </a>
        ) : (
          link[1]
        );
      }
      if (part.startsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
      return part;
    });
}
function DocumentText({ content }: { content: string }) {
  return (
    <div className="legal-document-text">
      {content
        .trim()
        .split(/\n\s*\n/)
        .map((block, i) => {
          if (block.startsWith("# ")) return null;
          if (block.startsWith("## "))
            return <h2 key={i}>{inline(block.slice(3))}</h2>;
          if (block.startsWith("### "))
            return <h3 key={i}>{inline(block.slice(4))}</h3>;
          if (block.startsWith("> "))
            return (
              <blockquote key={i}>
                {inline(block.replace(/^>\s?/gm, ""))}
              </blockquote>
            );
          if (block.startsWith("- "))
            return (
              <ul key={i}>
                {block.split(/\n- /).map((item, j) => (
                  <li key={j}>{inline(item.replace(/^- /, ""))}</li>
                ))}
              </ul>
            );
          if (block.startsWith("| ")) {
            const rows = block
              .split("\n")
              .filter((row) => !/^\|[\s:|\-]+\|$/.test(row))
              .map((row) =>
                row
                  .trim()
                  .slice(1, -1)
                  .split("|")
                  .map((cell) => cell.trim()),
              );
            return (
              <div
                key={i}
                className="legal-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Таблица документа"
              >
                <table>
                  <thead>
                    <tr>
                      {rows[0].map((cell, j) => (
                        <th key={j} scope="col">
                          {inline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(1).map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k}>{inline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          return <p key={i}>{inline(block)}</p>;
        })}
    </div>
  );
}

export function LegalPage() {
  const slug = location.pathname.split("/")[2];
  const hash = new URLSearchParams(location.search).get("hash");
  const [doc, setDoc] = useState<LegalDocument>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!slug) return;
    let active = true;
    api<LegalDocument>(
      `/legal/${encodeURIComponent(slug)}${hash ? `?hash=${encodeURIComponent(hash)}` : ""}`,
    )
      .then((data) => {
        if (active) {
          setDoc(data);
          document.title = `${data.title} · Гастро Двор`;
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [slug, hash]);
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Brand />
        <a href="/">
          <ArrowLeft size={16} /> На афишу
        </a>
      </header>
      <main>
        <span className="micro muted">ИНФОРМАЦИЯ ДЛЯ ГОСТЕЙ</span>
        <h1>{doc?.title || (slug ? "Документ" : "Документы сайта")}</h1>
        <LegalLinks />
        <ErrorNotice text={error} />
        {slug && !doc && !error && <Spinner />}
        {doc && (
          <>
            <div className="legal-version">
              <FileText size={16} /> Редакция {doc.version}
            </div>
            {doc.status === "draft" && (
              <div className="legal-draft" role="note">
                <strong>Предварительный просмотр</strong>
                <p>
                  В тексте отмечены пункты для уточнения. Эта редакция ещё не
                  применяется к реальным продажам.
                </p>
              </div>
            )}
            <DocumentText content={doc.content || ""} />
          </>
        )}
        <footer className="legal-contact">
          <strong>ООО «БРИЗ»</strong>
          <span>ИНН 9103090740 · ОГРН 1199112005124</span>
          <a href="mailto:event@chaika.team">event@chaika.team</a>
          <a href="tel:+79787873000">+7 978 78 73 000</a>
        </footer>
      </main>
    </div>
  );
}

type AcceptanceRecord = {
  kind: string;
  accepted_at: string;
  version: string;
  hash: string;
  title: string;
  slug: string;
  acceptance_label: string;
  withdrawn_at: string | null;
};
export function AcceptanceHistory({ orderId }: { orderId: string }) {
  const [records, setRecords] = useState<AcceptanceRecord[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<AcceptanceRecord[]>(`/admin/orders/${orderId}/acceptances`)
      .then((value) => {
        if (active) setRecords(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [orderId]);
  return (
    <div className="acceptance-history">
      <ErrorNotice text={error} />
      {!records && !error && <Spinner />}
      {records?.length === 0 && (
        <p>
          Для этого заказа подтверждения не записаны. Возможно, он оформлен до
          появления журнала или выпущен сотрудником.
        </p>
      )}
      {records?.map((record) => (
        <section key={record.kind}>
          <h3>{record.title}</h3>
          <p>{record.acceptance_label}</p>
          {record.kind === "marketing" && (
            <p>
              {record.withdrawn_at
                ? `Согласие отозвано: ${new Date(record.withdrawn_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`
                : "Согласие на рекламные СМС получено"}
            </p>
          )}
          <time dateTime={record.accepted_at}>
            {new Date(record.accepted_at).toLocaleString("ru-RU", {
              timeZone: "Europe/Moscow",
            })}{" "}
            МСК
          </time>
          <a
            href={`/legal/${record.slug}?hash=${record.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            Принятая редакция {record.version} ↗
          </a>
          <small>SHA-256: {record.hash}</small>
        </section>
      ))}
    </div>
  );
}

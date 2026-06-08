import { useEffect } from "react";

const C = {
  bg: "#050709",
  panel: "#080d18",
  gold: "#e8c96d",
  gold2: "#c9a84c",
  body: "#c8d4ee",
  muted: "#7d8aa6",
  border: "rgba(201,168,76,0.16)",
};

const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const SANS = "'Barlow', system-ui, -apple-system, sans-serif";

const SECTIONS = [
  {
    n: 1,
    title: "Introduction",
    body: [
      'This Privacy Policy explains how CLVRQuant / CLVRQuantAI ("CLVRQuant," "we," "us"), operated by [Legal Entity Name], 100 King St W, Toronto, ON, Canada, collects, uses, shares, and protects information when you use clvrquantai.com and related tools and services (the "Service"). By using the Service you agree to this Policy. If you do not agree, do not use the Service.',
    ],
  },
  {
    n: 2,
    title: "Information We Collect",
    bullets: [
      "Account information: name, email address, and credentials you provide when registering.",
      "Payment information: processed by our payment processor (Stripe). We receive limited billing details (such as subscription status and the last four digits of your card) but do NOT collect or store full card numbers.",
      "Usage and content data: tools you use, settings, watchlists/baskets, prompts and queries you submit, and interactions with AI features.",
      "Booking information: when you schedule a 1-on-1 session, the date, time, and time zone you select, and related scheduling details.",
      "Device and log data: IP address, browser type, device identifiers, and access timestamps collected automatically.",
      "Communications: messages you send to support@clvrquantai.com.",
    ],
  },
  {
    n: 3,
    title: "Google User Data",
    body: [
      "If you (or an administrator) connect Google services to enable scheduling features, we access Google data through Google APIs solely to provide those features. Specifically:",
    ],
    bullets: [
      "We use Google Calendar API access to create, update, and cancel calendar events for booked 1-on-1 sessions and to generate Google Meet links for those sessions.",
      "We access only the data necessary to create and manage these scheduling events. We do not read your unrelated calendar content for any other purpose.",
      "We retain Google-derived event data only as long as needed to manage the related booking, and we do not sell it or use it for advertising.",
    ],
    after: [
      "You can revoke our access at any time via your Google Account permissions at https://myaccount.google.com/permissions.",
    ],
  },
  {
    n: 4,
    title: "Limited Use Disclosure (Google API Services)",
    body: [
      "CLVRQuant's use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. We use Google user data only to provide and improve the user-facing scheduling features described above; we do not transfer or sell it to third parties except as necessary to provide those features, to comply with applicable law, or as part of a merger or acquisition; we do not use it for advertising; and we do not allow humans to read this data unless we obtain your affirmative agreement to view specific data, doing so is necessary for security purposes (such as investigating abuse) or to comply with applicable law, or the data (including derivations) are aggregated and used for internal operations in accordance with applicable privacy and other legal requirements.",
    ],
  },
  {
    n: 5,
    title: "How We Use Your Information",
    body: [
      "We use information to: provide, operate, and maintain the Service; create and manage your account and subscriptions; process payments and bookings; generate AI-based analysis and educational outputs you request; communicate with you (transactional emails, support, service notices); monitor, secure, debug, and improve the Service; and comply with legal obligations.",
    ],
  },
  {
    n: 6,
    title: "AI Processing",
    body: [
      "Prompts and inputs you submit to AI features are processed by our AI provider (Anthropic) to generate responses. Do not submit sensitive personal information you do not want processed this way.",
    ],
  },
  {
    n: 7,
    title: "Service Providers and Third Parties",
    body: [
      "We share information with vendors who process it on our behalf, under contractual confidentiality and data-protection obligations, including: Stripe (payments), Resend (transactional email), Railway (hosting and database), Google (calendar/scheduling), and Anthropic (AI processing). Market data is sourced from third parties including Finnhub, Binance, Hyperliquid, CryptoPanic, and RapidAPI. We do not sell your personal information.",
    ],
  },
  {
    n: 8,
    title: "Legal Disclosures",
    body: [
      "We may disclose information if required by law, subpoena, or government request, or to protect the rights, safety, and security of CLVRQuant, our users, or the public, or in connection with a merger, acquisition, or sale of assets.",
    ],
  },
  {
    n: 9,
    title: "Cookies and Tracking",
    body: [
      "We use cookies and similar technologies for authentication, session management, security, and to remember preferences. You can control cookies through your browser settings, though some features may not function without them.",
    ],
  },
  {
    n: 10,
    title: "Data Retention",
    body: [
      "We retain personal information for as long as your account is active or as needed to provide the Service, comply with legal obligations, resolve disputes, and enforce agreements. We delete or anonymize data when it is no longer needed. [Insert specific retention periods if applicable.]",
    ],
  },
  {
    n: 11,
    title: "Data Security",
    body: [
      "We use reasonable administrative, technical, and physical safeguards to protect your information. No method of transmission or storage is completely secure, and we cannot guarantee absolute security.",
    ],
  },
  {
    n: 12,
    title: "Your Rights and Choices",
    body: [
      "Depending on your location (including under Canada's PIPEDA, the EU/UK GDPR, and the California CCPA/CPRA), you may have rights to access, correct, delete, export, or restrict processing of your personal information, and to withdraw consent. To exercise these rights, or to request account and data deletion, email support@clvrquantai.com. We will respond as required by applicable law.",
    ],
  },
  {
    n: 13,
    title: "International Data Transfers",
    body: [
      "Your information may be processed and stored in countries other than where you live, including the United States and Canada. Where required, we use appropriate safeguards for such transfers.",
    ],
  },
  {
    n: 14,
    title: "Children's Privacy",
    body: [
      "The Service is not intended for anyone under 18, and we do not knowingly collect personal information from minors. If you believe a minor has provided us data, contact us and we will delete it.",
    ],
  },
  {
    n: 15,
    title: "Changes to This Policy",
    body: [
      'We may update this Policy from time to time. Material changes will be posted here with a revised "Last Updated" date. Continued use after changes constitutes acceptance.',
    ],
  },
  {
    n: 16,
    title: "Contact Us",
    body: [
      "Questions or privacy requests: support@clvrquantai.com — CLVRQuant, 100 King St W, Toronto, ON, Canada.",
    ],
  },
];

export default function PrivacyPage() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Privacy Policy — CLVRQuant";

    const desc =
      "CLVRQuant Privacy Policy — how we collect, use, and protect your data, including Google user data.";
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    const prevDesc = meta ? meta.getAttribute("content") : null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", desc);

    return () => {
      document.title = prevTitle;
      if (created) {
        meta.remove();
      } else if (prevDesc !== null) {
        meta.setAttribute("content", prevDesc);
      } else {
        meta.removeAttribute("content");
      }
    };
  }, []);

  return (
    <div
      data-testid="page-privacy"
      style={{
        minHeight: "100vh",
        background: C.bg,
        backgroundImage: `radial-gradient(circle at 50% -10%, ${C.panel} 0%, ${C.bg} 60%)`,
        color: C.body,
        fontFamily: SANS,
        padding: "clamp(40px, 8vw, 96px) 20px 80px",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <a
          href="/"
          data-testid="link-home"
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: C.muted,
            textDecoration: "none",
          }}
        >
          ← Back to CLVRQuant
        </a>

        <div
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            color: C.gold2,
            marginTop: 40,
            marginBottom: 14,
          }}
        >
          Legal
        </div>

        <h1
          style={{
            fontFamily: SERIF,
            fontSize: "clamp(34px, 7vw, 52px)",
            fontWeight: 700,
            lineHeight: 1.1,
            color: C.gold,
            margin: 0,
            letterSpacing: "0.01em",
          }}
        >
          Privacy Policy
        </h1>

        <div
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: "0.08em",
            color: C.muted,
            marginTop: 18,
            paddingBottom: 28,
            borderBottom: `1px solid ${C.border}`,
          }}
          data-testid="text-last-updated"
        >
          Last Updated: June 8, 2026
        </div>

        <div style={{ marginTop: 8 }}>
          {SECTIONS.map((s) => (
            <section key={s.n} style={{ marginTop: 38 }}>
              <h2
                style={{
                  fontFamily: SERIF,
                  fontSize: "clamp(20px, 4vw, 25px)",
                  fontWeight: 700,
                  color: C.gold,
                  margin: "0 0 14px",
                  lineHeight: 1.3,
                }}
              >
                {s.n}. {s.title}
              </h2>

              {(s.body || []).map((p, i) => (
                <p
                  key={`b-${i}`}
                  style={{
                    fontSize: 15.5,
                    lineHeight: 1.8,
                    color: C.body,
                    margin: "0 0 14px",
                  }}
                >
                  {p}
                </p>
              ))}

              {s.bullets && (
                <ul
                  style={{
                    margin: "0 0 14px",
                    paddingLeft: 22,
                    listStyle: "none",
                  }}
                >
                  {s.bullets.map((li, i) => (
                    <li
                      key={`li-${i}`}
                      style={{
                        position: "relative",
                        fontSize: 15.5,
                        lineHeight: 1.8,
                        color: C.body,
                        marginBottom: 10,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: -22,
                          color: C.gold2,
                        }}
                      >
                        ◆
                      </span>
                      {li}
                    </li>
                  ))}
                </ul>
              )}

              {(s.after || []).map((p, i) => (
                <p
                  key={`a-${i}`}
                  style={{
                    fontSize: 15.5,
                    lineHeight: 1.8,
                    color: C.body,
                    margin: "0 0 14px",
                  }}
                >
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <div
          style={{
            marginTop: 56,
            paddingTop: 24,
            borderTop: `1px solid ${C.border}`,
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: "0.08em",
            color: C.muted,
          }}
        >
          © 2026 CLVRQuant · 100 King St W, Toronto, ON, Canada
        </div>
      </div>
    </div>
  );
}

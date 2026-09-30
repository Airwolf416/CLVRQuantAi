import { useEffect } from "react";
import { LEGAL_ENTITY_NAME, SUPPORT_EMAIL } from "../config/legal";

export const TERMS_SECTIONS = [
  ["Service and eligibility", "CLVRQuant provides market information, analysis, and educational tools. You must be at least 18 and comply with laws applicable to your use of the service. These terms govern your access to the website and account."],
  ["Education only; trading risk", "Content, signals, forecasts, AI responses and trade ideas are for information and education only. They are not personalized investment, financial, tax or legal advice, an offer to trade, or a guarantee of any outcome. We do not act as your broker or adviser. You are responsible for your own research, decisions and risk management. Trading may result in substantial loss; past performance does not guarantee future results. Data and model outputs may be delayed, incomplete or wrong."],
  ["Accounts and acceptable use", "Provide accurate registration details, keep your credentials private and notify us of suspected unauthorized use. Do not abuse the service, scrape or redistribute data without permission, interfere with security or availability, or use the service unlawfully. We may restrict access to protect users and the service. You may close your account by contacting support."],
  ["Subscriptions and billing", "Free features cost nothing. Paid Pro and Elite plans are billed through Stripe at the price, currency and billing interval shown during checkout. A subscription renews automatically until canceled. You can manage or cancel it through the account billing portal; cancellation stops future renewals and access continues through the current paid period unless checkout terms say otherwise. Taxes, refunds and any promotional conditions are disclosed at checkout and handled according to applicable law. We will communicate material price changes before they apply to your renewal."],
  ["Availability and third-party services", "Features, data feeds and AI services depend on third parties and may change or be interrupted. We may update features or correct errors. Third-party platforms including Stripe and data providers have their own terms. Do not rely on continuous availability for time-sensitive trading."],
  ["Intellectual property", "The service's software, design and original content belong to their respective owners. You receive a limited, non-transferable right to use the service for personal purposes while your account remains active. You retain rights in content you submit and grant us permission to process it to provide the service, as described in the Privacy Policy."],
  ["Suspension and termination", "You may stop using the service and cancel a paid subscription at any time. We may suspend or terminate access for material violations, abuse, fraud, or legal or security requirements, with notice where reasonably possible. Termination does not remove payment obligations already incurred or rights provided by applicable law."],
  ["Disclaimers and liability", "We provide the service on an as-available basis, without promising accuracy, uninterrupted access or trading results. To the extent permitted by applicable law, we are not responsible for trading losses or indirect or consequential losses arising from use of the service. Nothing here excludes rights or remedies that cannot legally be excluded, or liability that cannot legally be limited."],
  ["Changes and contact", "We may revise these terms and will post updates here; material changes will be communicated where required. Continued use after changes take effect indicates acceptance, subject to applicable law. Questions: " + SUPPORT_EMAIL + "."],
];

export default function TermsPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = "Terms of Service — CLVRQuant";
    return () => { document.title = previous; };
  }, []);
  return <main data-testid="page-terms" style={{ minHeight: "100vh", background: "#050709", color: "#c8d4ee", fontFamily: "'Barlow', system-ui, sans-serif", padding: "clamp(40px, 8vw, 96px) 20px 80px" }}>
    <div style={{ maxWidth: 760, margin: "auto" }}>
      <a href="/" style={{ color: "#c9a84c", fontFamily: "monospace" }}>← Back to CLVRQuant</a>
      <h1 style={{ color: "#e8c96d", fontFamily: "Georgia, serif", fontSize: "clamp(34px, 7vw, 52px)", marginTop: 42 }}>Terms of Service</h1>
      <p>CLVRQuant is operated by {LEGAL_ENTITY_NAME}. Please read these terms before using the service.</p>
      {TERMS_SECTIONS.map(([title, text], i) => <section key={title} style={{ marginTop: 36 }}>
        <h2 style={{ color: "#e8c96d", fontFamily: "Georgia, serif" }}>{i + 1}. {title}</h2>
        <p style={{ lineHeight: 1.8 }}>{text}</p>
      </section>)}
      <p style={{ marginTop: 44 }}>See also our <a href="/privacy" style={{ color: "#e8c96d" }}>Privacy Policy</a>.</p>
    </div>
  </main>;
}
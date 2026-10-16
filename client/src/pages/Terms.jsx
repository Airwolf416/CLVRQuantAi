import { useEffect } from "react";
import { LEGAL_ENTITY_NAME, SUPPORT_EMAIL } from "../config/legal";

export const TERMS_SECTIONS = [
  ["Service Description", "CLVRQuant provides market data, market commentary, analytical tools, AI-generated research, alerts, and related educational features. Features and data availability may change or be interrupted, including when third-party services are unavailable."],
  ["Educational and Informational Purposes Only", "CLVRQuant is not a financial adviser, broker, or dealer. The Service does not provide financial, investment, tax, or legal advice; it does not execute trades or manage funds. Signals, analysis, AI responses, and market data are for educational and informational purposes only, may be delayed or inaccurate, and are not recommendations. You are solely responsible for your research, decisions, and risk. Trading involves substantial risk of loss; past performance does not guarantee future results."],
  ["Subscriptions and Billing", "Free: CAD $0. Pro: CAD $29.99 per month or CAD $299 per year. Elite: CAD $129 per month or CAD $1,199 per year. Paid subscriptions renew automatically at the selected interval until canceled. You may cancel anytime through Account → Manage Subscription; cancellation stops future renewals and paid access continues through the current billing period. There are no refunds for partial billing periods unless required by law. Applicable taxes may be added at checkout."],
  ["Accounts and Acceptable Use", "Provide accurate account information and protect your credentials. Do not use the Service unlawfully, attempt unauthorized access, interfere with its security or availability, scrape or redistribute data contrary to provider terms, or infringe others’ rights. You must be at least 18 or the age of majority where you live, whichever is greater."],
  ["Account Suspension and Termination", "You may stop using the Service and cancel a subscription at any time. We may suspend or terminate access for material violations, fraud, security risks, or legal requirements, and will provide notice where reasonably possible. Termination does not remove obligations already incurred or rights that cannot be waived under applicable law."],
  ["Intellectual Property", "The Service, its software, design, and original content are owned by CLVRQuant or their respective licensors. We grant you a limited, non-exclusive, non-transferable right to use the Service for personal, lawful purposes while your account is active. You retain rights in content you submit and permit us to process it as needed to provide the Service."],
  ["Disclaimer of Warranties", "The Service is provided on an “as available” basis. To the extent permitted by law, we make no warranty that data, analysis, or AI output will be accurate, complete, uninterrupted, or suitable for a particular purpose. You should not rely on the Service for time-sensitive trading decisions."],
  ["Limitation of Liability", "To the extent permitted by applicable law, CLVRQuant is not liable for indirect, incidental, special, consequential, or punitive damages, or for trading losses arising from use of the Service. Nothing in these Terms excludes rights or limits liability that cannot legally be excluded or limited."],
  ["Governing Law", "These Terms are governed by the laws of Ontario, Canada, and the applicable federal laws of Canada, without preventing you from relying on mandatory consumer-protection laws that apply where you live."],
  ["Changes to Terms", "We may update these Terms and will post the revised version here with a new effective and last-updated date. We will give notice of material changes where required by law. Continued use after an update takes effect means you accept the updated Terms, subject to applicable law."],
  ["Contact Us", `Questions about these Terms: ${SUPPORT_EMAIL}.`],
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
      <p>CLVRQuant is operated by {LEGAL_ENTITY_NAME}. Effective date: October 16, 2026. Last updated: October 16, 2026.</p>
      {TERMS_SECTIONS.map(([title, text], i) => <section key={title} style={{ marginTop: 36 }}>
        <h2 style={{ color: "#e8c96d", fontFamily: "Georgia, serif", ...(title === "Educational and Informational Purposes Only" ? { fontSize: 24, fontWeight: 900, textTransform: "uppercase" } : {}) }}>{i + 1}. {title}</h2>
        <p style={{ lineHeight: 1.8 }}>{text}</p>
      </section>)}
      <p style={{ marginTop: 44 }}>See also our <a href="/privacy" style={{ color: "#e8c96d" }}>Privacy Policy</a>.</p>
    </div>
  </main>;
}
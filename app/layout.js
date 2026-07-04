import "./globals.css";

const TITLE =
  "Suddhalaya — House of Purity | Organic A2 Dairy, Cold-Pressed Oils & Raw Honey";
const DESCRIPTION =
  "Suddhalaya brings farm-to-home organic essentials: A2 cow ghee, cold-pressed oils, raw forest honey and stone-ground staples. Traceable, lab-tested, and crafted with purity.";

export const metadata = {
  metadataBase: new URL("https://www.suddhalaya.com/"),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://www.suddhalaya.com/" },
  openGraph: {
    type: "website",
    siteName: "Suddhalaya",
    title: TITLE,
    description:
      "Farm-to-home organic essentials: bilona A2 ghee, wood-pressed oils, raw forest honey and stone-ground staples. Traceable and lab-tested.",
    url: "https://www.suddhalaya.com/",
    images: ["https://www.suddhalaya.com/social-card.jpg"],
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Suddhalaya — House of Purity",
    description:
      "Farm-to-home organic essentials: bilona A2 ghee, wood-pressed oils, raw forest honey and stone-ground staples. Traceable and lab-tested.",
    images: ["https://www.suddhalaya.com/social-card.jpg"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1f3520",
};

// Organisation structured data (Product + FAQ JSON-LD are injected dynamically by the engine).
const ORG_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Suddhalaya Organic Pvt Ltd",
  url: "https://www.suddhalaya.com/",
  description:
    "Farm-to-home organic essentials — traceable, lab-tested A2 ghee, cold-pressed oils, raw honey and staples.",
  email: "support@suddhalaya.com",
  address: { "@type": "PostalAddress", addressCountry: "IN" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_LD) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

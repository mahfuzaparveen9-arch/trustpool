import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Web3Provider } from "@/config/web3";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TrustPool — Onchain Credit Lending Protocol",
  description:
    "Your wallet is your credit score. Deposit collateral, borrow stablecoins, and build onchain credit history for prime rates on Base.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`light ${inter.variable} ${spaceGrotesk.variable}`}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[#FAF8F5] text-[#0F172A] min-h-screen flex flex-col selection:bg-indigo-100 selection:text-indigo-900 antialiased font-sans">
        <Web3Provider>{children}</Web3Provider>
      </body>
    </html>
  );
}

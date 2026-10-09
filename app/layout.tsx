import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import AppLayout from "./components/AppLayout";

const outfit = Outfit({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "NexusLabs Dashboard",
  description: "Advanced tracking dashboard for laboratory samples",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={outfit.className}>
      <body>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}

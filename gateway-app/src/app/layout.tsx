import type { Metadata } from "next";
import { Toaster } from "sonner";
import Navbar from "@/components/navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "LLM Gateway",
  description: "Self-service LLM API key management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">
        <Navbar />
        <main>{children}</main>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}

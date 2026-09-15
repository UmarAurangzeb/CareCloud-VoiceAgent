import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CareCloud Voice Agent",
  description: "Voice AI patient registration — live patient registry and browser call test.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">
        <nav className="border-b border-slate-800 px-4 sm:px-8">
          <div className="max-w-6xl mx-auto flex items-center gap-6 h-12 text-sm">
            <span className="font-semibold">Riverside Family Clinic</span>
            <Link href="/" className="text-slate-400 hover:text-slate-100">
              Patients
            </Link>
            <Link href="/vapi-test" className="text-slate-400 hover:text-slate-100">
              Talk to Alex
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}

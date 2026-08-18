import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/wayfinder/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wayfinder — Global Mobility Intelligence",
  description:
    "Wayfinder turns your intent into the best legal route across borders: evidence-backed, deterministic eligibility, Pareto-optimal trajectories, and the legitimate enablers who can unlock them.",
  keywords: [
    "global mobility",
    "immigration",
    "visa",
    "residence",
    "citizenship",
    "Wayfinder",
    "mobility intelligence",
  ],
  authors: [{ name: "Wayfinder" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Wayfinder — Global Mobility Intelligence",
    description:
      "Don't ask 'what visa can I get?' Tell Wayfinder what you're trying to make possible.",
    siteName: "Wayfinder",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

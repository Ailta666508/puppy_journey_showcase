import type { Metadata } from "next";
import { Geist, Geist_Mono, M_PLUS_Rounded_1c } from "next/font/google";

import { CoupleOnboardingGate } from "@/components/CoupleOnboardingGate";
import { DevAuthDebug } from "@/components/DevAuthDebug";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const mPlusRounded = M_PLUS_Rounded_1c({
  variable: "--font-map",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "PuppyJourney（双宠奇旅）",
  description: "双人共同成长陪伴应用",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${mPlusRounded.variable} antialiased`}
      >
        <CoupleOnboardingGate>
          {children}
          <DevAuthDebug />
        </CoupleOnboardingGate>
      </body>
    </html>
  );
}
